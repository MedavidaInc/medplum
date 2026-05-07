import { getExtensionValue } from '@medplum/core';
import type { MedplumClient } from '@medplum/core';
import type { CodeableConcept, Extension, MedicationStatement } from '@medplum/fhirtypes';
import {
  EXT_URLS,
  NON_RX_CATEGORY_SYSTEM,
  type MedicationInteractionFlag,
  type NonRxCategory,
  type NonRxMedicationRecommendation,
} from './non-rx-medication.types';

// ─── Builder: typed struct → FHIR MedicationStatement ────────────────────────

export function buildNonRxMedicationStatement(rec: NonRxMedicationRecommendation): MedicationStatement {
  const extensions: Extension[] = [];

  if (rec.evidenceGrade) {
    extensions.push({ url: EXT_URLS.EVIDENCE_GRADE, valueCode: rec.evidenceGrade });
  }
  if (rec.dosageNotes) {
    extensions.push({ url: EXT_URLS.DOSAGE_NOTES, valueString: rec.dosageNotes });
  }
  if (rec.thirdPartyTested !== undefined) {
    extensions.push({ url: EXT_URLS.THIRD_PARTY_TESTED, valueBoolean: rec.thirdPartyTested });
  }
  if (rec.thirdPartyTestOrg) {
    extensions.push({ url: EXT_URLS.THIRD_PARTY_TEST_ORG, valueString: rec.thirdPartyTestOrg });
  }
  if (rec.purchaseSource) {
    extensions.push({ url: EXT_URLS.PURCHASE_SOURCE, valueCode: rec.purchaseSource });
  }
  if (rec.botanicalPart) {
    extensions.push({ url: EXT_URLS.BOTANICAL_PART, valueString: rec.botanicalPart });
  }
  if (rec.discontinuedReason) {
    extensions.push({ url: EXT_URLS.DISCONTINUED_REASON, valueString: rec.discontinuedReason });
  }
  if (rec.interactionFlags?.length) {
    for (const flag of rec.interactionFlags) {
      extensions.push(buildInteractionFlagExtension(flag));
    }
  }

  return {
    resourceType: 'MedicationStatement',
    status: rec.status,
    subject: { reference: `Patient/${rec.patientId}` },
    informationSource: { reference: `Practitioner/${rec.practitionerId}` },
    medicationCodeableConcept: buildMedicationConcept(rec),
    category: {
      coding: [{ system: NON_RX_CATEGORY_SYSTEM, code: rec.category }],
    },
    dosage: rec.dosageText ? [{ text: rec.dosageText }] : undefined,
    reasonCode: rec.reasonText ? [{ text: rec.reasonText }] : undefined,
    effectivePeriod: {
      start: rec.startDate,
      end: rec.endDate,
    },
    extension: extensions.length > 0 ? extensions : undefined,
  };
}

function buildMedicationConcept(rec: NonRxMedicationRecommendation): CodeableConcept {
  const coding = [];

  if (rec.rxNormCode) {
    coding.push({ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: rec.rxNormCode, display: rec.name });
  }
  if (rec.nihDsldId) {
    coding.push({ system: 'https://dsld.nlm.nih.gov', code: rec.nihDsldId, display: rec.name });
  }
  if (rec.napralertId) {
    coding.push({ system: 'https://napralert.org', code: rec.napralertId, display: rec.name });
  }
  if (rec.hpusCode) {
    coding.push({ system: 'https://www.hpus.com', code: rec.hpusCode, display: rec.name });
  }
  if (rec.fdaUniiCode) {
    coding.push({ system: 'http://fdasis.nlm.nih.gov', code: rec.fdaUniiCode, display: rec.name });
  }

  return { coding: coding.length > 0 ? coding : undefined, text: rec.name };
}

function buildInteractionFlagExtension(flag: MedicationInteractionFlag): Extension {
  return {
    url: EXT_URLS.INTERACTION_FLAGS,
    extension: [
      { url: EXT_URLS.INTERACTION_FLAG_RX_ID, valueString: flag.medicationRequestId },
      { url: EXT_URLS.INTERACTION_FLAG_SEVERITY, valueCode: flag.severity },
      ...(flag.note ? [{ url: EXT_URLS.INTERACTION_FLAG_NOTE, valueString: flag.note }] : []),
    ],
  };
}

// ─── Parser: FHIR MedicationStatement → typed struct ─────────────────────────

export function parseNonRxMedicationStatement(stmt: MedicationStatement): NonRxMedicationRecommendation {
  const patientRef = stmt.subject?.reference ?? '';
  const patientId = patientRef.replace('Patient/', '');
  const practRef = stmt.informationSource?.reference ?? '';
  const practitionerId = practRef.replace('Practitioner/', '');

  const category = (stmt.category?.coding?.[0]?.code ?? 'vitamin-supplement') as NonRxCategory;
  const concept = stmt.medicationCodeableConcept ?? {};

  const interactionFlags = parseInteractionFlags(stmt.extension ?? []);

  return {
    patientId,
    practitionerId,
    category,
    name: concept.text ?? concept.coding?.[0]?.display ?? '',
    rxNormCode: concept.coding?.find((c) => c.system?.includes('rxnorm'))?.code,
    nihDsldId: concept.coding?.find((c) => c.system?.includes('dsld'))?.code,
    napralertId: concept.coding?.find((c) => c.system?.includes('napralert'))?.code,
    hpusCode: concept.coding?.find((c) => c.system?.includes('hpus'))?.code,
    fdaUniiCode: concept.coding?.find((c) => c.system?.includes('fdasis'))?.code,
    dosageText: stmt.dosage?.[0]?.text,
    reasonText: stmt.reasonCode?.[0]?.text,
    startDate: stmt.effectivePeriod?.start,
    endDate: stmt.effectivePeriod?.end,
    status: stmt.status,
    evidenceGrade: getExtensionValue(stmt, EXT_URLS.EVIDENCE_GRADE) as string | undefined as any,
    dosageNotes: getExtensionValue(stmt, EXT_URLS.DOSAGE_NOTES) as string | undefined,
    thirdPartyTested: getExtensionValue(stmt, EXT_URLS.THIRD_PARTY_TESTED) as boolean | undefined,
    thirdPartyTestOrg: getExtensionValue(stmt, EXT_URLS.THIRD_PARTY_TEST_ORG) as string | undefined as any,
    purchaseSource: getExtensionValue(stmt, EXT_URLS.PURCHASE_SOURCE) as string | undefined as any,
    botanicalPart: getExtensionValue(stmt, EXT_URLS.BOTANICAL_PART) as string | undefined,
    discontinuedReason: getExtensionValue(stmt, EXT_URLS.DISCONTINUED_REASON) as string | undefined,
    interactionFlags: interactionFlags.length > 0 ? interactionFlags : undefined,
  };
}

function parseInteractionFlags(extensions: Extension[]): MedicationInteractionFlag[] {
  return extensions
    .filter((e) => e.url === EXT_URLS.INTERACTION_FLAGS)
    .map((e) => {
      const nested = e.extension ?? [];
      const get = (url: string) => nested.find((n) => n.url === url);
      return {
        medicationRequestId: (get(EXT_URLS.INTERACTION_FLAG_RX_ID)?.valueString ?? ''),
        severity: (get(EXT_URLS.INTERACTION_FLAG_SEVERITY)?.valueCode ?? 'unknown') as MedicationInteractionFlag['severity'],
        note: get(EXT_URLS.INTERACTION_FLAG_NOTE)?.valueString,
      };
    });
}

// ─── Medplum client helpers ───────────────────────────────────────────────────

export async function createNonRxRecommendation(
  medplum: MedplumClient,
  rec: NonRxMedicationRecommendation
): Promise<MedicationStatement> {
  return medplum.createResource(buildNonRxMedicationStatement(rec));
}

export async function getNonRxRecommendations(
  medplum: MedplumClient,
  patientId: string
): Promise<NonRxMedicationRecommendation[]> {
  const results = await medplum.searchResources<MedicationStatement>(
    'MedicationStatement',
    `subject=Patient/${patientId}&category=${NON_RX_CATEGORY_SYSTEM}|`
  );
  return results.map(parseNonRxMedicationStatement);
}

export async function stopNonRxRecommendation(
  medplum: MedplumClient,
  statementId: string,
  reason: string
): Promise<MedicationStatement> {
  const stmt = await medplum.readResource<MedicationStatement>('MedicationStatement', statementId);
  return medplum.updateResource<MedicationStatement>({
    ...stmt,
    status: 'stopped',
    extension: [
      ...(stmt.extension ?? []),
      { url: EXT_URLS.DISCONTINUED_REASON, valueString: reason },
    ],
  });
}
