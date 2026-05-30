/**
 * PatientSubscription — custom FHIR resource representing a patient's
 * recurring substance subscription (billing schedule + bundled substances).
 *
 * Represented as a FHIR `Basic` resource with:
 *   code.coding[0].system = SUBSCRIPTION_CODE_SYSTEM
 *   code.coding[0].code   = 'PatientSubscription'
 *
 * All domain fields live as extensions under SUBSCRIPTION_EXT_BASE.
 * The resource is keyed on `subscription-id` (Django Subscription UUID)
 * via the SUBSCRIPTION_ID_SYSTEM identifier — upserts are idempotent.
 *
 * Written by Django on every Subscription save. Read by the React frontend
 * to display and manage a patient's active substance bundles.
 *
 * Medplum query pattern:
 *   GET /fhir/R4/Basic?code=PatientSubscription&subject=Patient/<id>
 */

import type { Basic } from '@medplum/fhirtypes';

export const SUBSCRIPTION_EXT_BASE = 'https://medavida.com/fhir/StructureDefinition/subscription';
export const SUBSCRIPTION_CODE_SYSTEM = 'https://medavida.com/fhir/CodeSystem/resource-type';
export const SUBSCRIPTION_ID_SYSTEM =
  'https://medavida.com/fhir/StructureDefinition/identifier/subscription-id';

export const SUBSCRIPTION_EXT_URLS = {
  SUBSCRIPTION_ID:    `${SUBSCRIPTION_EXT_BASE}-subscription-id`,
  STATUS:             `${SUBSCRIPTION_EXT_BASE}-status`,
  BILLING_INTERVAL:   `${SUBSCRIPTION_EXT_BASE}-billing-interval`,
  START_DATE:         `${SUBSCRIPTION_EXT_BASE}-start-date`,
  END_DATE:           `${SUBSCRIPTION_EXT_BASE}-end-date`,
  NEXT_BILLING_DATE:  `${SUBSCRIPTION_EXT_BASE}-next-billing-date`,
  LINE_ITEMS:         `${SUBSCRIPTION_EXT_BASE}-line-items`,
  NOTES:              `${SUBSCRIPTION_EXT_BASE}-notes`,
} as const;

// ─── Normalised structs (mirror Django models) ────────────────────────────────

export interface SubscriptionLineItem {
  /** Django SubstanceRequest UUID */
  substanceRequestId: string;
  /** Substance.name */
  substanceName: string;
  /** 'prescription' | 'nutraceutical' */
  requestType: string;
  /** ISO datetime when this substance was added to the bundle */
  addedAt: string;
  /** ISO datetime when removed, or null if still active */
  removedAt: string | null;
}

export interface PatientSubscriptionRecord {
  /** Django Subscription UUID — idempotency key */
  subscriptionId: string;

  /** FHIR Patient reference, e.g. "Patient/abc123" */
  patientReference: string;

  /** 'active' | 'paused' | 'cancelled' | 'expired' */
  status: string;

  /** 'monthly' | 'quarterly' | 'semi_annual' | 'annual' */
  billingInterval: string;

  /** ISO date string — subscription start date */
  startDate: string;

  /** ISO date string — optional hard end date */
  endDate?: string;

  /** ISO date string — when the next order should be generated */
  nextBillingDate?: string;

  /** Bundled SubstanceRequests */
  lineItems: SubscriptionLineItem[];

  notes?: string;

  /** Set when this record already exists on Medplum — used for upsert */
  fhirId?: string;
}

/** Convenience re-export so callers can type the raw Basic resource */
export type PatientSubscriptionBasic = Basic;
