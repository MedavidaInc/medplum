import type { MedicationStatement } from '@medplum/fhirtypes';

export const EXT_URLS = {
  EVIDENCE_GRADE: 'https://medavida.com/fhir/StructureDefinition/non-rx-evidence-grade',
  DOSAGE_NOTES: 'https://medavida.com/fhir/StructureDefinition/non-rx-dosage-notes',
  THIRD_PARTY_TESTED: 'https://medavida.com/fhir/StructureDefinition/non-rx-third-party-tested',
  THIRD_PARTY_TEST_ORG: 'https://medavida.com/fhir/StructureDefinition/non-rx-third-party-test-org',
  PURCHASE_SOURCE: 'https://medavida.com/fhir/StructureDefinition/non-rx-purchase-source',
  INTERACTION_FLAGS: 'https://medavida.com/fhir/StructureDefinition/non-rx-interaction-flags',
  INTERACTION_FLAG_RX_ID: 'https://medavida.com/fhir/StructureDefinition/non-rx-interaction-flag-rx-id',
  INTERACTION_FLAG_SEVERITY: 'https://medavida.com/fhir/StructureDefinition/non-rx-interaction-flag-severity',
  INTERACTION_FLAG_NOTE: 'https://medavida.com/fhir/StructureDefinition/non-rx-interaction-flag-note',
  BOTANICAL_PART: 'https://medavida.com/fhir/StructureDefinition/non-rx-botanical-part',
  DISCONTINUED_REASON: 'https://medavida.com/fhir/StructureDefinition/non-rx-discontinued-reason',
} as const;

export const NON_RX_CATEGORY_SYSTEM = 'https://medavida.com/fhir/CodeSystem/non-rx-category';

export type NonRxCategory = 'vitamin-supplement' | 'herbal-botanical' | 'homeopathic' | 'medical-food';

export type EvidenceGrade = 'A' | 'B' | 'C' | 'D' | 'I';

export type InteractionSeverity = 'contraindicated' | 'major' | 'moderate' | 'minor' | 'unknown';

export type PurchaseSource = 'pharmacy' | 'health-food-store' | 'online' | 'clinic' | 'other';

export type ThirdPartyTestOrg = 'USP' | 'NSF' | 'ConsumerLab' | 'Informed-Sport' | 'other';

export interface MedicationInteractionFlag {
  medicationRequestId: string;
  severity: InteractionSeverity;
  note?: string;
}

export interface NonRxMedicationRecommendation {
  // Core identity
  patientId: string;
  practitionerId: string;
  category: NonRxCategory;

  // What it is
  name: string;
  rxNormCode?: string;
  nihDsldId?: string;      // vitamins/supplements
  napralertId?: string;    // herbals
  hpusCode?: string;       // homeopathic
  fdaUniiCode?: string;    // medical foods
  botanicalPart?: string;  // herbals

  // Dosing
  dosageText?: string;
  dosageNotes?: string;

  // Clinical context
  evidenceGrade?: EvidenceGrade;
  reasonText?: string;

  // Safety
  interactionFlags?: MedicationInteractionFlag[];
  thirdPartyTested?: boolean;
  thirdPartyTestOrg?: ThirdPartyTestOrg;

  // Sourcing
  purchaseSource?: PurchaseSource;

  // Lifecycle
  status: MedicationStatement['status'];
  startDate?: string;
  endDate?: string;
  discontinuedReason?: string;
}
