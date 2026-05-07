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

  // Track the order lifecycle with a Task
  await medplum.createResource<Task>({
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
  });
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

  const medCoding = (rx.medicationCodeableConcept?.coding ?? [])[0];

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
      name: rx.medicationCodeableConcept?.text ?? medCoding?.display ?? '',
      rxNormCode: medCoding?.system === 'http://www.nlm.nih.gov/research/umls/rxnorm' ? medCoding.code : undefined,
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
  const rx = await medplum.readResource<MedicationRequest>('MedicationRequest', update.fhirMedicationRequestId);

  // Update MedicationRequest status
  const newRxStatus = pharmacyStatusToFhir(update.status);
  if (rx.status !== newRxStatus) {
    await medplum.updateResource<MedicationRequest>({ ...rx, status: newRxStatus });
  }

  // Update the tracking Task
  const tasks = await medplum.searchResources<Task>(
    'Task',
    `identifier=https://medavida.com/fhir/pharmacy-order-id|${update.pharmacyOrderId}`
  );
  if (tasks.length > 0) {
    const task = tasks[0];
    await medplum.updateResource<Task>({
      ...task,
      status: pharmacyStatusToTaskStatus(update.status),
      note: [
        ...(task.note ?? []),
        { text: `Pharmacy status update: ${update.status}${update.errorMessage ? ` — ${update.errorMessage}` : ''}` },
      ],
    });
  }

  // Alert clinician if action is needed
  if (update.status === 'error' || update.status === 'cancelled') {
    await medplum.createResource({
      resourceType: 'Communication',
      status: 'in-progress',
      subject: rx.subject,
      about: [createReference(rx)],
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
    });
  }

  // Create MedicationDispense on dispensing
  if (update.status === 'dispensed' && update.dispensedAt) {
    await medplum.createResource<MedicationDispense>({
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
    });
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
