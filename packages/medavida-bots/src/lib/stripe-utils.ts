import type { Coverage } from '@medplum/fhirtypes';
import type Stripe from 'stripe';

export function stripeStatusToFhir(stripeStatus: Stripe.Subscription.Status): Coverage['status'] {
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