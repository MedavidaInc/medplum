import { getExtensionValue } from '@medplum/core';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Coverage, Patient, PaymentNotice } from '@medplum/fhirtypes';
import Stripe from 'stripe';
import { stripeStatusToFhir } from '../lib/stripe-utils';

const EXT_STRIPE_SUBSCRIPTION_ID = 'https://medavida.com/fhir/StructureDefinition/stripe-subscription-id';

// Bot receives the raw Stripe event object (POSTed by Stripe webhook → Bot/$execute)
export async function handler(medplum: MedplumClient, event: BotEvent<Record<string, unknown>>): Promise<void> {
  const stripeEvent = event.input as unknown as Stripe.Event;

  if (!stripeEvent?.type) {
    throw new Error('Invalid Stripe event: missing type');
  }

  switch (stripeEvent.type) {
    case 'invoice.paid':
      await handleInvoicePaid(medplum, stripeEvent.data.object as Stripe.Invoice);
      break;
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(medplum, stripeEvent.data.object as Stripe.Invoice);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(medplum, stripeEvent.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(medplum, stripeEvent.data.object as Stripe.Subscription);
      break;
    default:
      console.log(`Unhandled Stripe event type: ${stripeEvent.type}`);
  }
}

function extractSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const sub = (invoice as unknown as Record<string, unknown>)['subscription'];
  return typeof sub === 'string' ? sub : (sub as Stripe.Subscription | null)?.id;
}

async function handleInvoicePaid(medplum: MedplumClient, invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) return;

  const coverage = await findCoverageBySubscription(medplum, subscriptionId);
  if (!coverage) {
    console.log('No coverage found for subscription', subscriptionId);
    return;
  }

  // Ensure coverage is active
  if (coverage.status !== 'active') {
    await medplum.updateResource<Coverage>({ ...coverage, status: 'active' });
  }

  await medplum.createResource<PaymentNotice>({
    resourceType: 'PaymentNotice',
    status: 'active',
    request: { reference: `Coverage/${coverage.id}` },
    payment: { reference: `Coverage/${coverage.id}` },
    recipient: coverage.beneficiary as unknown as PaymentNotice['recipient'],
    created: new Date().toISOString(),
    amount: { value: (invoice.amount_paid ?? 0) / 100, currency: (invoice.currency?.toUpperCase() ?? 'USD') as 'USD' },
    paymentStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/paymentstatus', code: 'paid' }],
      text: `Invoice paid — Stripe invoice ${invoice.id}`,
    },
  });
}

async function handleInvoicePaymentFailed(medplum: MedplumClient, invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) return;

  const coverage = await findCoverageBySubscription(medplum, subscriptionId);
  if (!coverage) return;

  // Move to draft (past_due) so clinical staff can see it
  await medplum.updateResource<Coverage>({ ...coverage, status: 'draft' });

  if (!coverage.beneficiary?.reference) {
    throw new Error(`Coverage ${coverage.id} has no beneficiary reference`);
  }
  const patient = await medplum.readReference<Patient>(coverage.beneficiary as any);

  // Create a Communication to alert the member
  await medplum.createResource({
    resourceType: 'Communication',
    status: 'in-progress',
    subject: { reference: `Patient/${patient.id}` },
    about: [{ reference: `Coverage/${coverage.id}` }],
    category: [
      {
        coding: [{ system: 'https://medavida.com/fhir/CodeSystem/communication-category', code: 'billing-alert' }],
      },
    ],
    payload: [
      {
        contentString: `Your DPC membership payment failed (Stripe invoice ${invoice.id}). Please update your payment method.`,
      },
    ],
    sent: new Date().toISOString(),
  });
}

async function handleSubscriptionDeleted(
  medplum: MedplumClient,
  subscription: Stripe.Subscription
): Promise<void> {
  const coverage = await findCoverageBySubscription(medplum, subscription.id);
  if (!coverage) return;

  await medplum.updateResource<Coverage>({ ...coverage, status: 'cancelled' });

  await medplum.createResource<PaymentNotice>({
    resourceType: 'PaymentNotice',
    status: 'active',
    request: { reference: `Coverage/${coverage.id}` },
    payment: { reference: `Coverage/${coverage.id}` },
    recipient: coverage.beneficiary as unknown as PaymentNotice['recipient'],
    created: new Date().toISOString(),
    amount: { value: 0, currency: 'USD' },
    paymentStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/paymentstatus', code: 'cancelled' }],
      text: `Stripe subscription ${subscription.id} deleted — coverage cancelled`,
    },
  });
}

async function handleSubscriptionUpdated(
  medplum: MedplumClient,
  subscription: Stripe.Subscription
): Promise<void> {
  const coverage = await findCoverageBySubscription(medplum, subscription.id);
  if (!coverage) return;

  const newStatus = stripeStatusToFhir(subscription.status);
  if (coverage.status !== newStatus) {
    await medplum.updateResource<Coverage>({ ...coverage, status: newStatus });
  }
}

async function findCoverageBySubscription(
  medplum: MedplumClient,
  subscriptionId: string
): Promise<Coverage | undefined> {
  // On a real Medplum server this requires a SearchParameter registered for
  // Coverage.extension:stripe-subscription-id. In tests we fall back to filtering all.
  const m = medplum as any;
  const results = (await m.searchResources('Coverage')) as Coverage[];
  return results.find(c => getExtensionValue(c, EXT_STRIPE_SUBSCRIPTION_ID) === subscriptionId);
}

