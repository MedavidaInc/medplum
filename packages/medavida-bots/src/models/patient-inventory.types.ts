/**
 * PatientInventory — custom FHIR resource tracking a patient's on-hand
 * medication supply.
 *
 * Represented as a FHIR `Basic` resource with:
 *   code.coding[0].system = INVENTORY_CODE_SYSTEM
 *   code.coding[0].code   = 'PatientInventory'
 *
 * All domain fields live as extensions under INVENTORY_EXT_BASE.
 * The resource is keyed on `inventory-id` (Django PatientInventory UUID)
 * via the INVENTORY_ID_SYSTEM identifier — upserts are idempotent.
 *
 * Written by Django. Read by the React frontend and any bot that needs
 * to check supply levels before triggering a reorder.
 *
 * Medplum query pattern:
 *   GET /fhir/R4/Basic?code=PatientInventory&subject=Patient/<id>
 */

import type { Basic } from '@medplum/fhirtypes';

export const INVENTORY_EXT_BASE = 'https://medavida.com/fhir/StructureDefinition/inventory';
export const INVENTORY_CODE_SYSTEM = 'https://medavida.com/fhir/CodeSystem/resource-type';
export const INVENTORY_ID_SYSTEM = 'https://medavida.com/fhir/StructureDefinition/identifier/inventory-id';

export const INVENTORY_EXT_URLS = {
  INVENTORY_ID:         `${INVENTORY_EXT_BASE}-inventory-id`,
  SKU_CODE:             `${INVENTORY_EXT_BASE}-sku-code`,
  CATALOGUE_ITEM_NAME:  `${INVENTORY_EXT_BASE}-catalogue-item-name`,
  QUANTITY_ON_HAND:     `${INVENTORY_EXT_BASE}-quantity-on-hand`,
  UNIT_TYPE:            `${INVENTORY_EXT_BASE}-unit-type`,
  LAST_REPLENISHED_AT:  `${INVENTORY_EXT_BASE}-last-replenished-at`,
  NOTES:                `${INVENTORY_EXT_BASE}-notes`,
} as const;

// ─── Normalised struct (mirrors Django PatientInventory model) ────────────────

export interface PatientInventoryRecord {
  /** Django PatientInventory UUID — idempotency key */
  inventoryId: string;

  /** FHIR Patient reference, e.g. "Patient/abc123" */
  patientReference: string;

  /** Catalogue SKU code */
  skuCode: string;

  /** Human-readable catalogue item name */
  catalogueItemName: string;

  /** Current on-hand quantity */
  quantityOnHand: number;

  /** Unit of measure, e.g. "ml", "unit", "mg" */
  unitType: string;

  /** ISO datetime of the last replenishment, if any */
  lastReplenishedAt?: string;

  notes?: string;

  /** Set when this record already exists on Medplum — used for upsert */
  fhirId?: string;
}

/** Convenience re-export so callers can type the raw Basic resource */
export type PatientInventoryBasic = Basic;
