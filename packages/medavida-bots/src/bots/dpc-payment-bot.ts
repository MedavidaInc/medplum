import { createReference, getExtensionValue } from '@medplum/core';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Coverage, Patient, PaymentNotice } from '@medplum/fhirtypes';
import Stripe from 'stripe';

// Extension URLs for Stripe IDs stored on FHIR resources
const EXT_STRIPE_CUSTOMER_ID = 'https://medavida.com/fhir/StructureDefinition/stripe-customer-id';
const EXT_STRIPE_SUBSCRIPTION_ID = 'https://medavida.com/fhir/StructureDefinition/stripe-subscription-id';

// Coverage.type coding that identifies DPC memberships
const DPC_COVERAGE_TYPE_CODE = 'PUBLICPOL';

type DpcAction = 'enroll' | 'cancel' | 'update_plan' | 'sync_status';

interface BotSecrets {
  STRIPE_SECRET_KEY: string;
  STRIPE_PRICE_INDIVIDUAL: string;
  STRIPE_PRICE_FAMILY: string;
  STRIPE_PRICE_SENIOR: string;
}

export async function handler(medplum: MedplumClient, event: BotEvent<Coverage>): Promise<void> {
  const coverage = event.input;
  const secrets = event.secrets as unknown as BotSecrets;

  if (!isDpcCoverage(coverage)) {
    return;
  }

  const stripe = new Stripe(secrets.STRIPE_SECRET_KEY);
  const action = resolveAction(coverage);

  const patientRef = coverage.beneficiary?.reference;
  if (!patientRef) {
    throw new Error('Coverage.beneficiary is required');
  }
  const patient = await medplum.readReference<Patient>({ reference: patientRef });

  switch (action) {
    case 'enroll':
      await enroll(medplum, stripe, coverage, patient, secrets);
      break;
    case 'cancel':
      await cancel(medplum, stripe, coverage, patient);
      break;
    case 'update_plan':
      await updatePlan(medplum, stripe, coverage, patient, secrets);
      break;
    case 'sync_status':
      await syncStatus(medplum, stripe, coverage, patient);
      break;
  }
}

function isDpcCoverage(coverage: Coverage): boolean {
  return coverage.type?.coding?.some((c) => c.code === DPC_COVERAGE_TYPE_CODE) ?? false;
}

function resolveAction(coverage: Coverage): DpcAction {
  if (coverage.status === 'cancelled') return 'cancel';
  const hasSub = !!getExtensionValue(coverage, EXT_STRIPE_SUBSCRIPTION_ID);
  if (!hasSub) return 'enroll';
  // Active coverage that already has a subscription — check if plan changed
  const planChanged = coverage.meta?.tag?.some((t) => t.code === 'plan-changed') ?? false;
  return planChanged ? 'update_plan' : 'sync_status';
}

function resolvePriceId(coverage: Coverage, secrets: BotSecrets): string {
  const planClass = coverage.class?.find((c) => c.type?.coding?.some((t) => t.code === 'plan'));
  const plan = planClass?.value ?? 'individual';
  if (plan === 'family') return secrets.STRIPE_PRICE_FAMILY;
  if (plan === 'senior') return secrets.STRIPE_PRICE_SENIOR;
  return secrets.STRIPE_PRICE_INDIVIDUAL;
}

async function enroll(
  medplum: MedplumClient,
  stripe: Stripe,
  coverage: Coverage,
  patient: Patient,
  secrets: BotSecrets
): Promise<void> {
  // Reuse existing Stripe customer or create one
  let customerId = getExtensionValue(patient, EXT_STRIPE_CUSTOMER_ID) as string | undefined;
  if (!customerId) {
    const email = patient.telecom?.find((t) => t.system === 'email')?.value;
    const name = [patient.name?.[0]?.given?.join(' '), patient.name?.[0]?.family].filter(Boolean).join(' ');
    const customer = await stripe.customers.create({ email, name, metadata: { patientId: patient.id ?? '' } });
    customerId = customer.id;

    await medplum.updateResource<Patient>({
      ...patient,
      extension: [
        ...(patient.extension ?? []),
        { url: EXT_STRIPE_CUSTOMER_ID, valueString: customerId },
      ],
    });
  }

  const priceId = resolvePriceId(coverage, secrets);
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    metadata: { coverageId: coverage.id ?? '', patientId: patient.id ?? '' },
  });

  const updatedCoverage = await medplum.updateResource<Coverage>({
    ...coverage,
    extension: [
      ...(coverage.extension ?? []),
      { url: EXT_STRIPE_SUBSCRIPTION_ID, valueString: subscription.id },
    ],
  });

  await writePaymentNotice(medplum, updatedCoverage, patient, 'active', 'DPC enrollment — Stripe subscription created');
}

async function cancel(
  medplum: MedplumClient,
  stripe: Stripe,
  coverage: Coverage,
  patient: Patient
): Promise<void> {
  const subscriptionId = getExtensionValue(coverage, EXT_STRIPE_SUBSCRIPTION_ID) as string | undefined;
  if (!subscriptionId) {
    console.log('No Stripe subscription found for coverage', coverage.id);
    return;
  }

  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  await writePaymentNotice(medplum, coverage, patient, 'cancelled', 'DPC cancellation — Stripe subscription set to cancel at period end');
}

async function updatePlan(
  medplum: MedplumClient,
  stripe: Stripe,
  coverage: Coverage,
  patient: Patient,
  secrets: BotSecrets
): Promise<void> {
  const subscriptionId = getExtensionValue(coverage, EXT_STRIPE_SUBSCRIPTION_ID) as string | undefined;
  if (!subscriptionId) {
    throw new Error('Cannot update plan: no Stripe subscription ID on coverage ' + coverage.id);
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const itemId = subscription.items.data[0]?.id;
  if (!itemId) {
    throw new Error('Stripe subscription has no line items: ' + subscriptionId);
  }

  const newPriceId = resolvePriceId(coverage, secrets);
  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price: newPriceId }],
    proration_behavior: 'create_prorations',
  });

  await writePaymentNotice(medplum, coverage, patient, 'active', 'DPC plan update — Stripe subscription updated with proration');
}

async function syncStatus(
  medplum: MedplumClient,
  stripe: Stripe,
  coverage: Coverage,
  patient: Patient
): Promise<void> {
  const subscriptionId = getExtensionValue(coverage, EXT_STRIPE_SUBSCRIPTION_ID) as string | undefined;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const fhirStatus = stripeStatusToFhir(subscription.status);

  if (coverage.status !== fhirStatus) {
    await medplum.updateResource<Coverage>({ ...coverage, status: fhirStatus });
    await writePaymentNotice(medplum, coverage, patient, fhirStatus, `DPC sync — Stripe status: ${subscription.status}`);
  }
}

function stripeStatusToFhir(stripeStatus: Stripe.Subscription.Status): Coverage['status'] {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'draft';
    case 'canceled':
      return 'cancelled';
    default:
      return 'draft';
  }
}

async function writePaymentNotice(
  medplum: MedplumClient,
  coverage: Coverage,
  patient: Patient,
  status: string,
  note: string
): Promise<PaymentNotice> {
  return medplum.createResource<PaymentNotice>({
    resourceType: 'PaymentNotice',
    status: 'active',
    request: createReference(coverage),
    created: new Date().toISOString(),
    recipient: createReference(patient),
    amount: { value: 0, currency: 'USD' },
    paymentStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/paymentstatus', code: status }],
      text: note,
    },
  });
}
