import type { MedplumClient } from '@medplum/core';
import type { Coverage, Patient } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { handler } from './dpc-payment-bot';

// Stripe is mocked at module level so no real HTTP calls are made
vi.mock('stripe', () => {
  const mockSub = {
    id: 'sub_test123',
    status: 'active',
    items: { data: [{ id: 'si_test123' }] },
  };
  class StripeMock {
    customers = { create: () => Promise.resolve({ id: 'cus_test123' }) };
    subscriptions = {
      create: () => Promise.resolve(mockSub),
      retrieve: () => Promise.resolve(mockSub),
      update: () => Promise.resolve(mockSub),
    };
  }
  return { default: StripeMock };
});

const SECRETS = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_INDIVIDUAL: 'price_individual',
  STRIPE_PRICE_FAMILY: 'price_family',
  STRIPE_PRICE_SENIOR: 'price_senior',
};

function makeCoverage(overrides: Partial<Coverage> = {}): Coverage {
  return {
    resourceType: 'Coverage',
    id: 'cov-1',
    status: 'active',
    subscriber: { reference: 'Patient/patient-1' },
    beneficiary: { reference: 'Patient/patient-1' },
    payor: [{ reference: 'Patient/patient-1' }],
    type: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'PUBLICPOL' }],
    },
    ...overrides,
  };
}

function makePatient(): Patient {
  return {
    resourceType: 'Patient',
    id: 'patient-1',
    name: [{ given: ['Jane'], family: 'Doe' }],
    telecom: [{ system: 'email', value: 'jane@example.com' }],
  };
}

describe('dpc-payment-bot', () => {
  let medplum: MedplumClient;

  beforeEach(async () => {
    medplum = new MockClient() as unknown as MedplumClient;
    await medplum.createResource(makePatient());
  });

  test('enroll — creates Stripe customer + subscription and writes PaymentNotice', async () => {
    const coverage = await medplum.createResource(makeCoverage());

    await handler(medplum, {
      bot: { reference: 'Bot/123' },
      input: coverage,
      contentType: 'application/fhir+json',
      secrets: SECRETS as any,
    });

    const notices = await medplum.searchResources('PaymentNotice');
    expect(notices.length).toBe(1);
    expect(notices[0].paymentStatus?.text).toContain('enrollment');
  });

  test('cancel — sets cancel_at_period_end and writes PaymentNotice', async () => {
    const coverage = await medplum.createResource(
      makeCoverage({
        status: 'cancelled',
        extension: [{ url: 'https://medavida.com/fhir/StructureDefinition/stripe-subscription-id', valueString: 'sub_test123' }],
      })
    );

    await handler(medplum, {
      bot: { reference: 'Bot/123' },
      input: coverage,
      contentType: 'application/fhir+json',
      secrets: SECRETS as any,
    });

    const notices = await medplum.searchResources('PaymentNotice');
    expect(notices.length).toBe(1);
    expect(notices[0].paymentStatus?.text).toContain('cancellation');
  });

  test('update_plan — updates Stripe subscription items and writes PaymentNotice', async () => {
    const coverage = await medplum.createResource(
      makeCoverage({
        meta: { tag: [{ code: 'plan-changed' }] },
        extension: [{ url: 'https://medavida.com/fhir/StructureDefinition/stripe-subscription-id', valueString: 'sub_test123' }],
        class: [{ type: { coding: [{ code: 'plan' }] }, value: 'family' }],
      })
    );

    await handler(medplum, {
      bot: { reference: 'Bot/123' },
      input: coverage,
      contentType: 'application/fhir+json',
      secrets: SECRETS as any,
    });

    const notices = await medplum.searchResources('PaymentNotice');
    expect(notices.length).toBe(1);
    expect(notices[0].paymentStatus?.text).toContain('plan update');
  });

  test('sync_status — no-op when Stripe status matches FHIR status', async () => {
    // mockSub has status: 'active', coverage is also 'active' — no update expected
    const coverage = await medplum.createResource(
      makeCoverage({
        status: 'active',
        extension: [{ url: 'https://medavida.com/fhir/StructureDefinition/stripe-subscription-id', valueString: 'sub_test123' }],
      })
    );

    await handler(medplum, {
      bot: { reference: 'Bot/123' },
      input: coverage,
      contentType: 'application/fhir+json',
      secrets: SECRETS as any,
    });

    // No PaymentNotice written when status is already in sync
    const notices = await medplum.searchResources('PaymentNotice');
    expect(notices.length).toBe(0);
    const updated = await medplum.readResource('Coverage', coverage.id as string);
    expect(updated.status).toBe('active');
  });

  test('ignores non-DPC coverage', async () => {
    const coverage = await medplum.createResource(
      makeCoverage({ type: { coding: [{ code: 'OTHER' }] } })
    );

    await handler(medplum, {
      bot: { reference: 'Bot/123' },
      input: coverage,
      contentType: 'application/fhir+json',
      secrets: SECRETS as any,
    });

    const notices = await medplum.searchResources('PaymentNotice');
    expect(notices.length).toBe(0);
  });
});
