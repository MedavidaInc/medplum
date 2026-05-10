import { createReference } from '@medplum/core';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type {
  MedicationDispense,
  MedicationRequest,
  Patient,
  Practitioner,
  Task,
} from '@medplum/fhirtypes';

// ─── Adapter payload types ────────────────────────────────────────────────────

export interface OutboundPrescriptionPayload {
  externalPatientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: string;
    address: PatientAddress;
    phone: string;
  };
  prescriber: {
    npi: string;
    firstName: string;
    lastName: string;
  };
  medication: {
    name: string;
    rxNormCode?: string;
    ndc?: string;
    strength?: string;
    doseForm?: string;
    quantity: number;
    daysSupply: number;
    refills: number;
    sig: string;
  };
  fhirMedicationRequestId: string;
}

export interface PatientAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

// Inbound webhook body from the pharmacy adapter
export interface PharmacyStatusUpdate {
  fhirMedicationRequestId: string;
  pharmacyOrderId: string;
  status: 'received' | 'verified' | 'filling' | 'ready' | 'dispensed' | 'cancelled' | 'error';
  errorMessage?: string;
  dispensedAt?: string;
  dispensedQuantity?: number;
  ndcDispensed?: string;
}

interface BotSecrets {
  PHARMACY_ADAPTER_URL: string;
  PHARMACY_ADAPTER_API_KEY: string;
  CLINIC_DEFAULT_NPI: string;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<MedicationRequest | PharmacyStatusUpdate>
): Promise<void> {
  const secrets = event.secrets as unknown as BotSecrets;

  // Distinguish outbound (MedicationRequest) from inbound (PharmacyStatusUpdate)
  if (isPharmacyStatusUpdate(event.input)) {
    await handleInbound(medplum, event.input);
  } else {
    await handleOutbound(medplum, event.input as MedicationRequest, secrets);
  }
}

function isPharmacyStatusUpdate(input: unknown): input is PharmacyStatusUpdate {
  return typeof input === 'object' && input !== null && 'pharmacyOrderId' in input;
}

// ─── Outbound: MedicationRequest → adapter ───────────────────────────────────

async function handleOutbound(
  medplum: MedplumClient,
  rx: MedicationRequest,
  secrets: BotSecrets
): Promise<void> {
  if (rx.status !== 'active') return;

  if (!rx.subject?.reference) {
    throw new Error(`MedicationRequest ${rx.id} has no subject reference`);
  }
  const patient = await medplum.readReference<Patient>(rx.subject as any);
  const prescriber = rx.requester?.reference
    ? await medplum.readReference<Practitioner>(rx.requester as any)
    : null;

  const payload = buildOutboundPayload(rx, patient, prescriber, secrets.CLINIC_DEFAULT_NPI);

  const response = await fetch(`${secrets.PHARMACY_ADAPTER_URL}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': secrets.PHARMACY_ADAPTER_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pharmacy adapter error ${response.status}: ${body}`);
  }

  const { pharmacyOrderId } = (await response.json()) as { pharmacyOrderId: string };

  // Track the order lifecycle with a Task — upsert so retries don't create duplicates
  await medplum.upsertResource<Task>(
    {
      resourceType: 'Task',
      status: 'in-progress',
      intent: 'order',
      code: {
        coding: [{ system: 'https://medavida.com/fhir/CodeSystem/task-type', code: 'pharmacy-order' }],
      },
      focus: createReference(rx),
      for: createReference(patient),
      authoredOn: new Date().toISOString(),
      identifier: [{ system: 'https://medavida.com/fhir/pharmacy-order-id', value: pharmacyOrderId }],
      note: [{ text: `Pharmacy order submitted. Adapter order ID: ${pharmacyOrderId}` }],
    },
    { identifier: `https://medavida.com/fhir/pharmacy-order-id|${pharmacyOrderId}` }
  );
}

function buildOutboundPayload(
  rx: MedicationRequest,
  patient: Patient,
  prescriber: Practitioner | null,
  defaultNpi: string
): OutboundPrescriptionPayload {
  const name = patient.name?.[0];
  const address = patient.address?.[0];
  const dob = patient.birthDate ?? '';
  const phone = patient.telecom?.find((t) => t.system === 'phone')?.value ?? '';

  const prescriberName = prescriber?.name?.[0];
  const npi =
    prescriber?.identifier?.find((id) => id.system === 'http://hl7.org/fhir/sid/us-npi')?.value ??
    defaultNpi;

  const codings = rx.medicationCodeableConcept?.coding ?? [];
  const rxNormCoding = codings.find((c) => c.system === 'http://www.nlm.nih.gov/research/umls/rxnorm');
  const ndcCoding = codings.find((c) => c.system === 'http://hl7.org/fhir/sid/ndc');

  const strengthExt = rx.extension?.find(
    (e) => e.url === 'https://medavida.com/fhir/StructureDefinition/medication-strength'
  )?.valueString;
  const doseFormExt = rx.extension?.find(
    (e) => e.url === 'https://medavida.com/fhir/StructureDefinition/medication-dose-form'
  )?.valueString;

  return {
    externalPatientId: patient.id ?? '',
    patient: {
      firstName: name?.given?.join(' ') ?? '',
      lastName: name?.family ?? '',
      dateOfBirth: dob,
      gender: patient.gender ?? 'unknown',
      phone,
      address: {
        line1: address?.line?.[0] ?? '',
        line2: address?.line?.[1],
        city: address?.city ?? '',
        state: address?.state ?? '',
        zip: address?.postalCode ?? '',
      },
    },
    prescriber: {
      npi,
      firstName: prescriberName?.given?.join(' ') ?? '',
      lastName: prescriberName?.family ?? '',
    },
    medication: {
      name: rx.medicationCodeableConcept?.text ?? rxNormCoding?.display ?? '',
      rxNormCode: rxNormCoding?.code,
      ndc: ndcCoding?.code,
      strength: strengthExt,
      doseForm: doseFormExt,
      quantity: rx.dispenseRequest?.quantity?.value ?? 30,
      daysSupply: rx.dispenseRequest?.expectedSupplyDuration?.value ?? 30,
      refills: rx.dispenseRequest?.numberOfRepeatsAllowed ?? 0,
      sig: rx.dosageInstruction?.[0]?.text ?? '',
    },
    fhirMedicationRequestId: rx.id ?? '',
  };
}

// ─── Inbound: pharmacy adapter → FHIR ────────────────────────────────────────

async function handleInbound(medplum: MedplumClient, update: PharmacyStatusUpdate): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = medplum as any;
  const rx = await m.readResource('MedicationRequest', update.fhirMedicationRequestId) as MedicationRequest;

  // Update MedicationRequest status
  const newRxStatus = pharmacyStatusToFhir(update.status);
  if (rx.status !== newRxStatus) {
    await m.updateResource({ ...rx, status: newRxStatus });
  }

  // Update the tracking Task
  const tasks = await m.searchResources(
    'Task',
    `identifier=https://medavida.com/fhir/pharmacy-order-id|${update.pharmacyOrderId}`
  ) as Task[];
  if (tasks.length > 0) {
    const task = tasks[0];
    await m.updateResource({
      ...task,
      status: pharmacyStatusToTaskStatus(update.status),
      note: [
        ...(task.note ?? []),
        { text: `Pharmacy status update: ${update.status}${update.errorMessage ? ` — ${update.errorMessage}` : ''}` },
      ],
    });
  } else {
    console.warn(
      `pharmacy-order-bot: no Task found for pharmacy order ${update.pharmacyOrderId} — status ${update.status} not recorded`
    );
  }

  // Alert clinician if action is needed — upsert so retries don't create duplicate alerts
  if (update.status === 'error' || update.status === 'cancelled') {
    const alertIdentifierSystem = 'https://medavida.com/fhir/pharmacy-alert-id';
    const alertIdentifierValue = `${update.pharmacyOrderId}-${update.status}`;
    await medplum.upsertResource(
      {
        resourceType: 'Communication',
        status: 'in-progress',
        subject: rx.subject,
        about: [createReference(rx)],
        identifier: [{ system: alertIdentifierSystem, value: alertIdentifierValue }],
        category: [
          {
            coding: [{ system: 'https://medavida.com/fhir/CodeSystem/communication-category', code: 'pharmacy-alert' }],
          },
        ],
        payload: [
          {
            contentString: `Pharmacy order ${update.pharmacyOrderId} ${update.status}${update.errorMessage ? `: ${update.errorMessage}` : ''}. Review required.`,
          },
        ],
        sent: new Date().toISOString(),
      },
      { identifier: `${alertIdentifierSystem}|${alertIdentifierValue}` }
    );
  }

  // Create MedicationDispense on dispensing — upsert so retries don't create duplicates
  if (update.status === 'dispensed' && update.dispensedAt) {
    await medplum.upsertResource<MedicationDispense>(
      {
        resourceType: 'MedicationDispense',
        status: 'completed',
        medicationCodeableConcept: rx.medicationCodeableConcept ?? { text: 'Unknown' },
        subject: rx.subject,
        authorizingPrescription: [createReference(rx)],
        quantity: update.dispensedQuantity
          ? { value: update.dispensedQuantity, unit: 'each' }
          : undefined,
        whenHandedOver: update.dispensedAt,
        identifier: [{ system: 'https://medavida.com/fhir/pharmacy-order-id', value: update.pharmacyOrderId }],
      },
      { identifier: `https://medavida.com/fhir/pharmacy-order-id|${update.pharmacyOrderId}` }
    );
  }
}

function pharmacyStatusToFhir(status: PharmacyStatusUpdate['status']): MedicationRequest['status'] {
  switch (status) {
    case 'received':
    case 'verified':
    case 'filling':
    case 'ready':
      return 'active';
    case 'dispensed':
      return 'completed';
    case 'cancelled':
    case 'error':
      return 'cancelled';
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled pharmacy status: ${_exhaustive}`);
    }
  }
}

function pharmacyStatusToTaskStatus(status: PharmacyStatusUpdate['status']): Task['status'] {
  switch (status) {
    case 'dispensed':
      return 'completed';
    case 'cancelled':
    case 'error':
      return 'failed';
    default:
      return 'in-progress';
  }
}
