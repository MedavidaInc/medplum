import type { MedplumClient } from '@medplum/core';
import type { Coverage, Patient } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { handler } from './stripe-webhook-bot';

vi.mock('stripe', () => ({ default: vi.fn() }));

const SECRETS = { STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake' };

const SUBSCRIPTION_ID = 'sub_webhook_test';
const EXT_STRIPE_SUBSCRIPTION_ID = 'https://medavida.com/fhir/StructureDefinition/stripe-subscription-id';

function botEvent(stripeEvent: Record<string, unknown>) {
  return { bot: { reference: 'Bot/123' }, input: stripeEvent, contentType: 'application/json', secrets: SECRETS as any };
}

describe('stripe-webhook-bot', () => {
  let medplum: MedplumClient;
  let coverage: Coverage;

  beforeEach(async () => {
    medplum = new MockClient() as unknown as MedplumClient;
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      id: 'patient-wh-1',
      name: [{ given: ['John'], family: 'Smith' }],
    });
    coverage = await medplum.createResource<Coverage>({
      resourceType: 'Coverage',
      status: 'active',
      beneficiary: { reference: `Patient/${patient.id}` },
      payor: [{ reference: `Patient/${patient.id}` }],
      type: { coding: [{ code: 'PUBLICPOL' }] },
      extension: [{ url: EXT_STRIPE_SUBSCRIPTION_ID, valueString: SUBSCRIPTION_ID }],
    });
  });

  test('invoice.paid — writes PaymentNotice', async () => {
    await handler(medplum, botEvent({
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_paid_1',
          object: 'invoice',
          subscription: SUBSCRIPTION_ID,
          amount_paid: 4900,
          currency: 'usd',
        },
      },
    }));

    const notices = await medplum.searchResources('PaymentNotice');
    expect(notices.length).toBe(1);
    expect(notices[0].amount?.value).toBe(49);
    expect(notices[0].paymentStatus?.coding?.[0]?.code).toBe('paid');
  });

  test('invoice.payment_failed — sets coverage to draft and creates Communication', async () => {
    await handler(medplum, botEvent({
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_fail_1',
          object: 'invoice',
          subscription: SUBSCRIPTION_ID,
          amount_due: 4900,
          currency: 'usd',
        },
      },
    }));

    const updated = await medplum.readResource('Coverage', coverage.id as string);
    expect(updated.status).toBe('draft');

    const comms = await medplum.searchResources('Communication') as any[];
    const alert = comms.find((c: any) => c.payload?.[0]?.contentString?.includes('payment failed'));
    expect(alert).toBeDefined();
  });

  test('customer.subscription.deleted — cancels coverage and writes PaymentNotice', async () => {
    await handler(medplum, botEvent({
      type: 'customer.subscription.deleted',
      data: {
        object: { id: SUBSCRIPTION_ID, object: 'subscription', status: 'canceled' },
      },
    }));

    const updated = await medplum.readResource('Coverage', coverage.id as string);
    expect(updated.status).toBe('cancelled');

    const notices = await medplum.searchResources('PaymentNotice');
    expect(notices.length).toBe(1);
  });

  test('customer.subscription.updated — updates coverage status when changed', async () => {
    // Coverage starts as active; subscription reports past_due → expect draft
    await handler(medplum, botEvent({
      type: 'customer.subscription.updated',
      data: {
        object: { id: SUBSCRIPTION_ID, object: 'subscription', status: 'past_due' },
      },
    }));

    const updated = await medplum.readResource('Coverage', coverage.id as string);
    expect(updated.status).toBe('draft');
  });

  test('customer.subscription.updated — no-op when status already matches', async () => {
    // Coverage is active, subscription also active → no update
    await handler(medplum, botEvent({
      type: 'customer.subscription.updated',
      data: {
        object: { id: SUBSCRIPTION_ID, object: 'subscription', status: 'active' },
      },
    }));

    const updated = await medplum.readResource('Coverage', coverage.id as string);
    expect(updated.status).toBe('active');
  });

  test('ignores unknown event types without throwing', async () => {
    await expect(
      handler(medplum, botEvent({ type: 'charge.captured', data: { object: {} } }))
    ).resolves.toBeUndefined();
  });
});
