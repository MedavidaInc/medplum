import type { MedplumClient } from '@medplum/core';
import type { MedicationRequest, Patient, Practitioner, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { handler, type PharmacyStatusUpdate } from './pharmacy-order-bot';

const SECRETS = {
  PHARMACY_ADAPTER_URL: 'https://adapter.example.com',
  PHARMACY_ADAPTER_API_KEY: 'test-key',
  CLINIC_DEFAULT_NPI: '1234567890',
};

function botEvent(input: MedicationRequest | PharmacyStatusUpdate) {
  return { bot: { reference: 'Bot/123' }, input, contentType: 'application/json', secrets: SECRETS as any };
}

describe('pharmacy-order-bot', () => {
  let medplum: MedplumClient;
  let patient: Patient;
  let prescriber: Practitioner;
  let rx: MedicationRequest;

  beforeEach(async () => {
    medplum = new MockClient() as unknown as MedplumClient;

    patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Alice'], family: 'Doe' }],
      birthDate: '1985-04-12',
      gender: 'female',
      telecom: [{ system: 'phone', value: '555-1234' }],
      address: [{ line: ['123 Main St'], city: 'Springfield', state: 'IL', postalCode: '62701' }],
    });

    prescriber = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ given: ['Bob'], family: 'Smith' }],
      identifier: [{ system: 'http://hl7.org/fhir/sid/us-npi', value: '9876543210' }],
    });

    rx = await medplum.createResource<MedicationRequest>({
      resourceType: 'MedicationRequest',
      status: 'active',
      intent: 'order',
      subject: { reference: `Patient/${patient.id}` },
      requester: { reference: `Practitioner/${prescriber.id}` },
      medicationCodeableConcept: {
        coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '1049502', display: 'Amoxicillin 500mg' }],
        text: 'Amoxicillin 500mg capsule',
      },
      dispenseRequest: { quantity: { value: 30 }, numberOfRepeatsAllowed: 2 },
      dosageInstruction: [{ text: 'Take 1 capsule three times daily' }],
    });
  });

  describe('outbound (MedicationRequest → adapter)', () => {
    test('posts to adapter and creates a Task', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ pharmacyOrderId: 'ph_order_001' }),
      } as Response);

      await handler(medplum, botEvent(rx));

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/orders'),
        expect.objectContaining({ method: 'POST' })
      );

      const m = medplum as any;
      const tasks = (await m.searchResources('Task', 'identifier=https://medavida.com/fhir/pharmacy-order-id|ph_order_001')) as Task[];
      expect(tasks.length).toBe(1);
      expect(tasks[0].identifier?.[0]?.value).toBe('ph_order_001');
      expect(tasks[0].status).toBe('in-progress');
    });

    test('uses defaultNpi when MedicationRequest has no requester', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ pharmacyOrderId: 'ph_order_npi' }),
      } as Response);

      const noPrescriberRx = await medplum.createResource<MedicationRequest>({
        ...rx,
        id: undefined,
        requester: undefined,
      });
      await handler(medplum, botEvent(noPrescriberRx));

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.prescriber.npi).toBe(SECRETS.CLINIC_DEFAULT_NPI);
    });

    test('skips non-active MedicationRequests', async () => {
      global.fetch = vi.fn();
      const draftRx = await medplum.createResource<MedicationRequest>({ ...rx, id: undefined, status: 'draft' });
      await handler(medplum, botEvent(draftRx));
      expect(fetch).not.toHaveBeenCalled();
    });

    test('throws when adapter returns error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal error' } as Response);
      await expect(handler(medplum, botEvent(rx))).rejects.toThrow('Pharmacy adapter error 500');
    });
  });

  describe('inbound (adapter → FHIR)', () => {
    let task: Task;

    beforeEach(async () => {
      task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'in-progress',
        intent: 'order',
        identifier: [{ system: 'https://medavida.com/fhir/pharmacy-order-id', value: 'ph_order_001' }],
        focus: { reference: `MedicationRequest/${rx.id}` },
        for: { reference: `Patient/${patient.id}` },
      });
    });

    test('dispensed — completes rx, task, and creates MedicationDispense', async () => {
      await handler(medplum, botEvent({
        fhirMedicationRequestId: rx.id ?? '',
        pharmacyOrderId: 'ph_order_001',
        status: 'dispensed',
        dispensedAt: '2026-05-06T10:00:00Z',
        dispensedQuantity: 30,
      }));

      const m = medplum as any;
      const updatedRx = (await m.readResource('MedicationRequest', rx.id as string)) as MedicationRequest;
      expect(updatedRx.status).toBe('completed');

      const updatedTask = (await m.readResource('Task', task.id as string)) as Task;
      expect(updatedTask.status).toBe('completed');

      const dispenses = await medplum.searchResources('MedicationDispense');
      expect(dispenses.length).toBe(1);
    });

    test('error status — marks task failed and creates Communication alert', async () => {
      await handler(medplum, botEvent({
        fhirMedicationRequestId: rx.id ?? '',
        pharmacyOrderId: 'ph_order_001',
        status: 'error',
        errorMessage: 'Drug interaction check failed',
      }));

      const m = medplum as any;
      const updatedTask = (await m.readResource('Task', task.id as string)) as Task;
      expect(updatedTask.status).toBe('failed');

      const allComms = await medplum.searchResources('Communication') as any[];
      const alert = allComms.find((c: any) => c.payload?.[0]?.contentString?.includes('Drug interaction check failed'));
      expect(alert).toBeDefined();
    });

    test.each([
      ['received',  'active',     'in-progress'],
      ['verified',  'active',     'in-progress'],
      ['filling',   'active',     'in-progress'],
      ['ready',     'active',     'in-progress'],
    ] as const)('%s — sets rx to %s and task to %s without creating alerts', async (status, expectedRxStatus, expectedTaskStatus) => {
      await handler(medplum, botEvent({
        fhirMedicationRequestId: rx.id ?? '',
        pharmacyOrderId: 'ph_order_001',
        status,
      }));

      const m = medplum as any;
      const updatedRx = (await m.readResource('MedicationRequest', rx.id as string)) as MedicationRequest;
      expect(updatedRx.status).toBe(expectedRxStatus);

      const updatedTask = (await m.readResource('Task', task.id as string)) as Task;
      expect(updatedTask.status).toBe(expectedTaskStatus);

      // Intermediate statuses must not create Communication alerts or MedicationDispenses
      const comms = await medplum.searchResources('Communication') as any[];
      const alerts = comms.filter((c: any) =>
        c.payload?.[0]?.contentString?.includes('ph_order_001')
      );
      expect(alerts.length).toBe(0);
      const dispenses = await medplum.searchResources('MedicationDispense');
      expect(dispenses.length).toBe(0);
    });
  });
});
