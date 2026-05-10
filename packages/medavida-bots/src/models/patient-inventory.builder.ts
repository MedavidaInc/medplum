/**
 * Builder and parser for the PatientInventory custom FHIR resource.
 *
 * PatientInventory is represented as a FHIR `Basic` resource written by
 * Django whenever a patient's on-hand supply changes. The React frontend
 * reads these to display current inventory levels; bots read them to decide
 * whether a reorder is needed.
 *
 * Idempotency: all upserts are keyed on `inventoryId` (Django
 * PatientInventory UUID) via the INVENTORY_ID_SYSTEM identifier.
 */

import { getExtensionValue } from '@medplum/core';
import type { MedplumClient } from '@medplum/core';
import type { Basic, Extension } from '@medplum/fhirtypes';
import {
  INVENTORY_CODE_SYSTEM,
  INVENTORY_EXT_URLS,
  INVENTORY_ID_SYSTEM,
  type PatientInventoryRecord,
} from './patient-inventory.types';

// ─── Builder: PatientInventoryRecord → FHIR Basic ────────────────────────────

export function buildPatientInventory(rec: PatientInventoryRecord): Basic {
  const extensions: Extension[] = [
    { url: INVENTORY_EXT_URLS.INVENTORY_ID,        valueString:  rec.inventoryId },
    { url: INVENTORY_EXT_URLS.SKU_CODE,            valueString:  rec.skuCode },
    { url: INVENTORY_EXT_URLS.CATALOGUE_ITEM_NAME, valueString:  rec.catalogueItemName },
    { url: INVENTORY_EXT_URLS.QUANTITY_ON_HAND,    valueDecimal: rec.quantityOnHand },
    { url: INVENTORY_EXT_URLS.UNIT_TYPE,           valueCode:    rec.unitType },
  ];

  if (rec.lastReplenishedAt) {
    extensions.push({ url: INVENTORY_EXT_URLS.LAST_REPLENISHED_AT, valueDateTime: rec.lastReplenishedAt });
  }
  if (rec.notes) {
    extensions.push({ url: INVENTORY_EXT_URLS.NOTES, valueString: rec.notes });
  }

  const resource: Basic = {
    resourceType: 'Basic',
    identifier: [{ system: INVENTORY_ID_SYSTEM, value: rec.inventoryId }],
    code: {
      coding: [{ system: INVENTORY_CODE_SYSTEM, code: 'PatientInventory' }],
    },
    subject: { reference: rec.patientReference },
    extension: extensions,
  };

  if (rec.fhirId) {
    resource.id = rec.fhirId.replace(/^Basic\//, '');
  }

  return resource;
}

// ─── Parser: FHIR Basic → PatientInventoryRecord ─────────────────────────────

export function parsePatientInventory(resource: Basic): PatientInventoryRecord {
  function str(url: string): string | undefined {
    return getExtensionValue(resource, url) as string | undefined;
  }
  function num(url: string): number | undefined {
    const v = getExtensionValue(resource, url);
    return v !== undefined ? Number(v) : undefined;
  }

  return {
    inventoryId:       str(INVENTORY_EXT_URLS.INVENTORY_ID) ?? '',
    patientReference:  resource.subject?.reference ?? '',
    skuCode:           str(INVENTORY_EXT_URLS.SKU_CODE) ?? '',
    catalogueItemName: str(INVENTORY_EXT_URLS.CATALOGUE_ITEM_NAME) ?? '',
    quantityOnHand:    num(INVENTORY_EXT_URLS.QUANTITY_ON_HAND) ?? 0,
    unitType:          str(INVENTORY_EXT_URLS.UNIT_TYPE) ?? '',
    lastReplenishedAt: str(INVENTORY_EXT_URLS.LAST_REPLENISHED_AT),
    notes:             str(INVENTORY_EXT_URLS.NOTES),
    fhirId:            resource.id,
  };
}

// ─── Medplum client helpers ───────────────────────────────────────────────────

/**
 * Upsert a PatientInventory on Medplum, keyed on inventoryId.
 * Returns the saved Basic resource.
 */
export async function upsertPatientInventory(
  medplum: MedplumClient,
  rec: PatientInventoryRecord,
): Promise<Basic> {
  const resource = buildPatientInventory(rec);
  return medplum.upsertResource(resource, {
    identifier: `${INVENTORY_ID_SYSTEM}|${rec.inventoryId}`,
  } as Record<string, string>);
}

/**
 * Fetch all PatientInventory records for a patient.
 */
export async function getInventoryForPatient(
  medplum: MedplumClient,
  patientReference: string,
): Promise<PatientInventoryRecord[]> {
  const patientId = patientReference.replace('Patient/', '');
  const bundle = await medplum.search('Basic', {
    code: `${INVENTORY_CODE_SYSTEM}|PatientInventory`,
    subject: `Patient/${patientId}`,
  });
  return (bundle.entry ?? [])
    .map(e => e.resource as Basic)
    .filter(Boolean)
    .map(parsePatientInventory);
}

/**
 * Fetch a single PatientInventory record by Django inventory UUID.
 */
export async function getInventoryById(
  medplum: MedplumClient,
  inventoryId: string,
): Promise<PatientInventoryRecord | undefined> {
  const bundle = await medplum.search('Basic', {
    identifier: `${INVENTORY_ID_SYSTEM}|${inventoryId}`,
  });
  const resource = bundle.entry?.[0]?.resource as Basic | undefined;
  return resource ? parsePatientInventory(resource) : undefined;
}
