/**
 * Builder and parser for the MedicationDelivery custom FHIR resource.
 *
 * On Medplum, custom resource types are represented as `Basic` resources.
 * The `code` field acts as the type discriminator; all domain fields live
 * as typed extensions.
 *
 * Idempotency: all upserts are keyed on the `lineItemId` extension, which
 * maps to the Django SubscriptionLineItem UUID.
 */

import { getExtensionValue } from '@medplum/core';
import type { MedplumClient } from '@medplum/core';
import type { Basic, Extension, Reference } from '@medplum/fhirtypes';
import {
  DELIVERY_CODE_SYSTEM,
  DELIVERY_EXT_URLS,
  LINE_ITEM_SYSTEM,
  type DeliveryConfirmedBy,
  type DeliveryStatus,
  type MedicationDeliveryRecord,
} from './medication-delivery.types';

// ─── Builder: MedicationDeliveryRecord → FHIR Basic ──────────────────────────

export function buildMedicationDelivery(rec: MedicationDeliveryRecord): Basic {
  const extensions: Extension[] = [
    { url: DELIVERY_EXT_URLS.LINE_ITEM_ID, valueString: rec.lineItemId },
    { url: DELIVERY_EXT_URLS.STATUS, valueCode: rec.status },
  ];

  if (rec.medicationRequestReference) {
    extensions.push({
      url: DELIVERY_EXT_URLS.MEDICATION_REQUEST,
      valueReference: { reference: rec.medicationRequestReference },
    });
  }
  if (rec.medicationDispenseReference) {
    extensions.push({
      url: DELIVERY_EXT_URLS.MEDICATION_DISPENSE,
      valueReference: { reference: rec.medicationDispenseReference },
    });
  }
  if (rec.carrier) {
    extensions.push({ url: DELIVERY_EXT_URLS.CARRIER, valueString: rec.carrier });
  }
  if (rec.trackingNumber) {
    extensions.push({ url: DELIVERY_EXT_URLS.TRACKING_NUMBER, valueString: rec.trackingNumber });
  }
  if (rec.trackingUrl) {
    extensions.push({ url: DELIVERY_EXT_URLS.TRACKING_URL, valueUri: rec.trackingUrl });
  }
  if (rec.shippedAt) {
    extensions.push({ url: DELIVERY_EXT_URLS.SHIPPED_AT, valueDateTime: rec.shippedAt });
  }
  if (rec.outForDeliveryAt) {
    extensions.push({ url: DELIVERY_EXT_URLS.OUT_FOR_DELIVERY_AT, valueDateTime: rec.outForDeliveryAt });
  }
  if (rec.deliveredAt) {
    extensions.push({ url: DELIVERY_EXT_URLS.DELIVERED_AT, valueDateTime: rec.deliveredAt });
  }
  if (rec.confirmedBy) {
    extensions.push({ url: DELIVERY_EXT_URLS.CONFIRMED_BY, valueCode: rec.confirmedBy });
  }
  if (rec.deliveryPhotoUrl) {
    extensions.push({ url: DELIVERY_EXT_URLS.DELIVERY_PHOTO_URL, valueUri: rec.deliveryPhotoUrl });
  }
  if (rec.signatureObtained !== undefined) {
    extensions.push({ url: DELIVERY_EXT_URLS.SIGNATURE_OBTAINED, valueBoolean: rec.signatureObtained });
  }
  if (rec.notes) {
    extensions.push({ url: DELIVERY_EXT_URLS.NOTES, valueString: rec.notes });
  }

  const resource: Basic = {
    resourceType: 'Basic',
    identifier: [{ system: LINE_ITEM_SYSTEM, value: rec.lineItemId }],
    code: {
      coding: [{ system: DELIVERY_CODE_SYSTEM, code: 'MedicationDelivery' }],
    },
    subject: { reference: rec.patientReference },
    extension: extensions,
  };

  if (rec.fhirId) {
    resource.id = rec.fhirId.replace(/^Basic\//, '');
  }

  return resource;
}

// ─── Parser: FHIR Basic → MedicationDeliveryRecord ───────────────────────────

export function parseMedicationDelivery(resource: Basic): MedicationDeliveryRecord {
  const ext = resource.extension ?? [];

  function str(url: string): string | undefined {
    return getExtensionValue(resource, url) as string | undefined;
  }
  function bool(url: string): boolean | undefined {
    const v = getExtensionValue(resource, url);
    return v !== undefined ? Boolean(v) : undefined;
  }
  function ref(url: string): string | undefined {
    const found = ext.find(e => e.url === url);
    return (found?.valueReference as Reference | undefined)?.reference;
  }

  return {
    lineItemId:                   str(DELIVERY_EXT_URLS.LINE_ITEM_ID) ?? '',
    patientReference:             resource.subject?.reference ?? '',
    medicationRequestReference:   ref(DELIVERY_EXT_URLS.MEDICATION_REQUEST),
    medicationDispenseReference:  ref(DELIVERY_EXT_URLS.MEDICATION_DISPENSE),
    status:                       (str(DELIVERY_EXT_URLS.STATUS) ?? 'pending') as DeliveryStatus,
    carrier:                      str(DELIVERY_EXT_URLS.CARRIER),
    trackingNumber:               str(DELIVERY_EXT_URLS.TRACKING_NUMBER),
    trackingUrl:                  str(DELIVERY_EXT_URLS.TRACKING_URL),
    shippedAt:                    str(DELIVERY_EXT_URLS.SHIPPED_AT),
    outForDeliveryAt:             str(DELIVERY_EXT_URLS.OUT_FOR_DELIVERY_AT),
    deliveredAt:                  str(DELIVERY_EXT_URLS.DELIVERED_AT),
    confirmedBy:                  str(DELIVERY_EXT_URLS.CONFIRMED_BY) as DeliveryConfirmedBy | undefined,
    deliveryPhotoUrl:             str(DELIVERY_EXT_URLS.DELIVERY_PHOTO_URL),
    signatureObtained:            bool(DELIVERY_EXT_URLS.SIGNATURE_OBTAINED),
    notes:                        str(DELIVERY_EXT_URLS.NOTES),
    fhirId:                       resource.id,
  };
}

// ─── Medplum client helpers ───────────────────────────────────────────────────

/**
 * Upsert a MedicationDelivery on Medplum, keyed on lineItemId.
 * Returns the saved Basic resource.
 */
export async function upsertMedicationDelivery(
  medplum: MedplumClient,
  rec: MedicationDeliveryRecord,
): Promise<Basic> {
  const resource = buildMedicationDelivery(rec);
  return medplum.upsertResource(resource, {
    identifier: `${LINE_ITEM_SYSTEM}|${rec.lineItemId}`,
  } as Record<string, string>);
}

/**
 * Fetch all MedicationDelivery records for a patient.
 */
export async function getDeliveriesForPatient(
  medplum: MedplumClient,
  patientReference: string,
): Promise<MedicationDeliveryRecord[]> {
  const patientId = patientReference.replace('Patient/', '');
  const bundle = await medplum.search('Basic', {
    code: `${DELIVERY_CODE_SYSTEM}|MedicationDelivery`,
    subject: `Patient/${patientId}`,
  });
  return (bundle.entry ?? [])
    .map(e => e.resource as Basic)
    .filter(Boolean)
    .map(parseMedicationDelivery);
}

/**
 * Fetch a single MedicationDelivery by Django line item ID.
 */
export async function getDeliveryByLineItemId(
  medplum: MedplumClient,
  lineItemId: string,
): Promise<MedicationDeliveryRecord | undefined> {
  const bundle = await medplum.search('Basic', {
    identifier: `${LINE_ITEM_SYSTEM}|${lineItemId}`,
  });
  const resource = bundle.entry?.[0]?.resource as Basic | undefined;
  return resource ? parseMedicationDelivery(resource) : undefined;
}
