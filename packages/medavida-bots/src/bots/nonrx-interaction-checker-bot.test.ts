import type { MedicationRequest, MedicationStatement, Patient, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeEach, describe, expect, test } from 'vitest';
import { handler } from './nonrx-interaction-checker-bot';
import { buildNonRxMedicationStatement } from '../models/non-rx-medication.builder';
import { NON_RX_CATEGORY_SYSTEM } from '../models/non-rx-medication.types';

function botEvent(rx: MedicationRequest) {
  return { bot: { reference: 'Bot/123' }, input: rx, contentType: 'application/fhir+json', secrets: {} };
}

function makeRx(patientId: string, rxNormCode: string, name: string, status: MedicationRequest['status'] = 'active'): MedicationRequest {
  return {
    resourceType: 'MedicationRequest',
    status,
    intent: 'order',
    subject: { reference: `Patient/${patientId}` },
    medicationCodeableConcept: {
      coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: rxNormCode, display: name }],
      text: name,
    },
    dosageInstruction: [{ text: 'As directed' }],
  };
}

function makeNonRxStatement(patientId: string, practitionerId: string, name: string): MedicationStatement {
  return buildNonRxMedicationStatement({
    patientId,
    practitionerId,
    category: 'vitamin-supplement',
    name,
    status: 'active',
  });
}

describe('nonrx-interaction-checker-bot', () => {
  let medplum: MockClient;
  let patient: Patient;

  beforeEach(async () => {
    medplum = new MockClient();
    patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Test'], family: 'User' }],
    });
  });

  test('warfarin + fish oil → creates interaction Task', async () => {
    await medplum.createResource<MedicationStatement>(makeNonRxStatement(patient.id!, 'pract-1', 'Fish Oil 1000mg'));

    const rx = await medplum.createResource<MedicationRequest>(makeRx(patient.id!, '855288', 'Warfarin 5mg'));
    await handler(medplum, botEvent(rx));

    const tasks = await medplum.searchResources<Task>('Task');
    expect(tasks.length).toBe(1);
    expect(tasks[0].description).toContain('Fish Oil');
    expect(tasks[0].priority).toBe('routine');
  });

  test('warfarin + St. John\'s Wort → contraindicated, task is urgent', async () => {
    await medplum.createResource<MedicationStatement>(makeNonRxStatement(patient.id!, 'pract-1', "St. John's Wort 300mg"));

    const rx = await medplum.createResource<MedicationRequest>(makeRx(patient.id!, '855288', 'Warfarin 5mg'));
    await handler(medplum, botEvent(rx));

    const tasks = await medplum.searchResources<Task>('Task');
    expect(tasks.length).toBe(1);
    expect(tasks[0].priority).toBe('urgent');

    // Non-Rx statement should be moved to 'intended' (paused)
    const stmts = await medplum.searchResources<MedicationStatement>(
      'MedicationStatement',
      `subject=Patient/${patient.id}&category=${NON_RX_CATEGORY_SYSTEM}|`
    );
    expect(stmts[0].status).toBe('intended');
  });

  test('no non-Rx records → no task created', async () => {
    const rx = await medplum.createResource<MedicationRequest>(makeRx(patient.id!, '855288', 'Warfarin 5mg'));
    await handler(medplum, botEvent(rx));

    const tasks = await medplum.searchResources<Task>('Task');
    expect(tasks.length).toBe(0);
  });

  test('no matching interaction → no task created', async () => {
    await medplum.createResource<MedicationStatement>(makeNonRxStatement(patient.id!, 'pract-1', 'Vitamin C 500mg'));

    const rx = await medplum.createResource<MedicationRequest>(makeRx(patient.id!, '855288', 'Warfarin 5mg'));
    await handler(medplum, botEvent(rx));

    const tasks = await medplum.searchResources<Task>('Task');
    expect(tasks.length).toBe(0);
  });

  test('inactive MedicationRequest is skipped', async () => {
    await medplum.createResource<MedicationStatement>(makeNonRxStatement(patient.id!, 'pract-1', 'Fish Oil 1000mg'));

    const rx = await medplum.createResource<MedicationRequest>(makeRx(patient.id!, '855288', 'Warfarin 5mg', 'stopped'));
    await handler(medplum, botEvent(rx));

    const tasks = await medplum.searchResources<Task>('Task');
    expect(tasks.length).toBe(0);
  });
});
