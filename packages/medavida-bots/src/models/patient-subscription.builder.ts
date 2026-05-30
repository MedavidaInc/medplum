/**
 * Builder and parser for the PatientSubscription custom FHIR resource.
 *
 * PatientSubscription is represented as a FHIR `Basic` resource written by
 * Django whenever a Subscription is created or updated. The React frontend
 * reads these to display and manage a patient's active substance bundles.
 *
 * Idempotency: all upserts are keyed on `subscriptionId` (Django Subscription
 * UUID) via the SUBSCRIPTION_ID_SYSTEM identifier.
 */

import { getExtensionValue } from '@medplum/core';
import type { MedplumClient } from '@medplum/core';
import type { Basic, Extension } from '@medplum/fhirtypes';
import {
  SUBSCRIPTION_CODE_SYSTEM,
  SUBSCRIPTION_EXT_URLS,
  SUBSCRIPTION_ID_SYSTEM,
  type PatientSubscriptionRecord,
  type SubscriptionLineItem,
} from './patient-subscription.types';

// ─── Builder: PatientSubscriptionRecord → FHIR Basic ─────────────────────────

export function buildPatientSubscription(rec: PatientSubscriptionRecord): Basic {
  const extensions: Extension[] = [
    { url: SUBSCRIPTION_EXT_URLS.SUBSCRIPTION_ID,  valueString: rec.subscriptionId },
    { url: SUBSCRIPTION_EXT_URLS.STATUS,           valueCode:   rec.status },
    { url: SUBSCRIPTION_EXT_URLS.BILLING_INTERVAL, valueCode:   rec.billingInterval },
    { url: SUBSCRIPTION_EXT_URLS.START_DATE,       valueDate:   rec.startDate },
  ];

  if (rec.endDate) {
    extensions.push({ url: SUBSCRIPTION_EXT_URLS.END_DATE, valueDate: rec.endDate });
  }
  if (rec.nextBillingDate) {
    extensions.push({ url: SUBSCRIPTION_EXT_URLS.NEXT_BILLING_DATE, valueDate: rec.nextBillingDate });
  }
  if (rec.notes) {
    extensions.push({ url: SUBSCRIPTION_EXT_URLS.NOTES, valueString: rec.notes });
  }
  if (rec.lineItems.length > 0) {
    extensions.push({
      url: SUBSCRIPTION_EXT_URLS.LINE_ITEMS,
      valueString: JSON.stringify(rec.lineItems),
    });
  }

  const resource: Basic = {
    resourceType: 'Basic',
    identifier: [{ system: SUBSCRIPTION_ID_SYSTEM, value: rec.subscriptionId }],
    code: {
      coding: [{ system: SUBSCRIPTION_CODE_SYSTEM, code: 'PatientSubscription' }],
    },
    subject: { reference: rec.patientReference },
    extension: extensions,
  };

  if (rec.fhirId) {
    resource.id = rec.fhirId.replace(/^Basic\//, '');
  }

  return resource;
}

// ─── Parser: FHIR Basic → PatientSubscriptionRecord ──────────────────────────

export function parsePatientSubscription(resource: Basic): PatientSubscriptionRecord {
  function str(url: string): string | undefined {
    return getExtensionValue(resource, url) as string | undefined;
  }

  const lineItemsRaw = str(SUBSCRIPTION_EXT_URLS.LINE_ITEMS);
  let lineItems: SubscriptionLineItem[] = [];
  if (lineItemsRaw) {
    try {
      lineItems = JSON.parse(lineItemsRaw) as SubscriptionLineItem[];
    } catch {
      lineItems = [];
    }
  }

  return {
    subscriptionId:   str(SUBSCRIPTION_EXT_URLS.SUBSCRIPTION_ID) ?? '',
    patientReference: resource.subject?.reference ?? '',
    status:           str(SUBSCRIPTION_EXT_URLS.STATUS) ?? 'active',
    billingInterval:  str(SUBSCRIPTION_EXT_URLS.BILLING_INTERVAL) ?? 'monthly',
    startDate:        str(SUBSCRIPTION_EXT_URLS.START_DATE) ?? '',
    endDate:          str(SUBSCRIPTION_EXT_URLS.END_DATE),
    nextBillingDate:  str(SUBSCRIPTION_EXT_URLS.NEXT_BILLING_DATE),
    lineItems,
    notes:            str(SUBSCRIPTION_EXT_URLS.NOTES),
    fhirId:           resource.id,
  };
}

// ─── Medplum client helpers ───────────────────────────────────────────────────

/**
 * Upsert a PatientSubscription on Medplum, keyed on subscriptionId.
 * Returns the saved Basic resource.
 */
export async function upsertPatientSubscription(
  medplum: MedplumClient,
  rec: PatientSubscriptionRecord,
): Promise<Basic> {
  const resource = buildPatientSubscription(rec);
  return medplum.upsertResource(resource, {
    identifier: `${SUBSCRIPTION_ID_SYSTEM}|${rec.subscriptionId}`,
  } as Record<string, string>);
}

/**
 * Fetch all PatientSubscription records for a patient.
 */
export async function getSubscriptionsForPatient(
  medplum: MedplumClient,
  patientReference: string,
): Promise<PatientSubscriptionRecord[]> {
  const patientId = patientReference.replace('Patient/', '');
  const bundle = await medplum.search('Basic', {
    code: `${SUBSCRIPTION_CODE_SYSTEM}|PatientSubscription`,
    subject: `Patient/${patientId}`,
  });
  return (bundle.entry ?? [])
    .map((e) => e.resource as Basic)
    .filter(Boolean)
    .map(parsePatientSubscription);
}

/**
 * Fetch a single PatientSubscription by Django Subscription UUID.
 */
export async function getSubscriptionById(
  medplum: MedplumClient,
  subscriptionId: string,
): Promise<PatientSubscriptionRecord | undefined> {
  const bundle = await medplum.search('Basic', {
    identifier: `${SUBSCRIPTION_ID_SYSTEM}|${subscriptionId}`,
  });
  const resource = bundle.entry?.[0]?.resource as Basic | undefined;
  return resource ? parsePatientSubscription(resource) : undefined;
}
