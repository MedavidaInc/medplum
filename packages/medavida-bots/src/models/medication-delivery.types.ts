/**
 * MedicationDelivery — custom FHIR resource for drop-ship medication delivery tracking.
 *
 * Represented as a FHIR `Basic` resource with:
 *   code.coding[0].system = DELIVERY_CODE_SYSTEM
 *   code.coding[0].code   = 'MedicationDelivery'
 *
 * All domain fields live as extensions under DELIVERY_EXT_BASE.
 *
 * Medplum query pattern:
 *   GET /fhir/R4/Basic?code=MedicationDelivery&subject=Patient/<id>
 */

import type { Basic } from '@medplum/fhirtypes';

export const DELIVERY_EXT_BASE = 'https://medavida.com/fhir/StructureDefinition/delivery';
export const DELIVERY_CODE_SYSTEM = 'https://medavida.com/fhir/CodeSystem/resource-type';
export const LINE_ITEM_SYSTEM = 'https://medavida.com/fhir/StructureDefinition/identifier/line-item-id';

export const DELIVERY_EXT_URLS = {
  // References to related FHIR resources
  MEDICATION_REQUEST:   `${DELIVERY_EXT_BASE}-medication-request`,
  MEDICATION_DISPENSE:  `${DELIVERY_EXT_BASE}-medication-dispense`,
  LINE_ITEM_ID:         `${DELIVERY_EXT_BASE}-line-item-id`,

  // Status & lifecycle
  STATUS:               `${DELIVERY_EXT_BASE}-status`,
  SHIPPED_AT:           `${DELIVERY_EXT_BASE}-shipped-at`,
  OUT_FOR_DELIVERY_AT:  `${DELIVERY_EXT_BASE}-out-for-delivery-at`,
  DELIVERED_AT:         `${DELIVERY_EXT_BASE}-delivered-at`,
  CONFIRMED_BY:         `${DELIVERY_EXT_BASE}-confirmed-by`,

  // Carrier
  CARRIER:              `${DELIVERY_EXT_BASE}-carrier`,
  TRACKING_NUMBER:      `${DELIVERY_EXT_BASE}-tracking-number`,
  TRACKING_URL:         `${DELIVERY_EXT_BASE}-tracking-url`,

  // Proof of delivery
  DELIVERY_PHOTO_URL:   `${DELIVERY_EXT_BASE}-delivery-photo-url`,
  SIGNATURE_OBTAINED:   `${DELIVERY_EXT_BASE}-signature-obtained`,

  NOTES:                `${DELIVERY_EXT_BASE}-notes`,
} as const;

// ─── Status vocabulary ────────────────────────────────────────────────────────

export type DeliveryStatus =
  | 'pending'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed_attempt'
  | 'returned';

export type DeliveryConfirmedBy = 'carrier' | 'patient' | 'staff';

// ─── Normalised struct (mirrors Django MedicationDelivery model) ──────────────

export interface MedicationDeliveryRecord {
  /** Django SubscriptionLineItem UUID — used as idempotency key */
  lineItemId: string;

  /** FHIR Patient reference, e.g. "Patient/abc123" */
  patientReference: string;

  /** MedicationRequest FHIR reference for this line item, e.g. "MedicationRequest/xyz" */
  medicationRequestReference?: string;

  /** MedicationDispense FHIR reference (set when supplier ships) */
  medicationDispenseReference?: string;

  status: DeliveryStatus;

  // Carrier
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;

  // Timestamps (ISO date or datetime strings)
  shippedAt?: string;
  outForDeliveryAt?: string;
  deliveredAt?: string;

  // Confirmation
  confirmedBy?: DeliveryConfirmedBy;
  deliveryPhotoUrl?: string;
  signatureObtained?: boolean;

  notes?: string;

  /** Set when this record already exists on Medplum — used for upsert */
  fhirId?: string;
}

/** Convenience re-export so callers can type the raw Basic resource */
export type MedicationDeliveryBasic = Basic;