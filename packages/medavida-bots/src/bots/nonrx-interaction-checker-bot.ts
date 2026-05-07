import { createReference } from '@medplum/core';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { MedicationRequest, MedicationStatement } from '@medplum/fhirtypes';
import { getNonRxRecommendations, stopNonRxRecommendation } from '../models/non-rx-medication.builder';
import type { InteractionSeverity, NonRxMedicationRecommendation } from '../models/non-rx-medication.types';
import { EXT_URLS, NON_RX_CATEGORY_SYSTEM } from '../models/non-rx-medication.types';

// ─── Static interaction rules ─────────────────────────────────────────────────
// Each rule maps an RxNorm code to a list of non-Rx product names / RxNorm codes
// that have a known interaction, with severity and a clinical note.
// In production this can be replaced with a call to a drug interaction API.

interface InteractionRule {
  rxNormCodes: string[];       // trigger Rx codes
  nonRxNames: RegExp[];        // match against non-Rx product name (case-insensitive)
  severity: InteractionSeverity;
  note: string;
}

const INTERACTION_RULES: InteractionRule[] = [
  {
    rxNormCodes: ['855288', '1049502'], // Warfarin, some antibiotics (examples)
    nonRxNames: [/fish.?oil/i, /omega.?3/i],
    severity: 'moderate',
    note: 'Fish oil / Omega-3 may potentiate anticoagulant effect. Monitor INR.',
  },
  {
    rxNormCodes: ['855288'], // Warfarin
    nonRxNames: [/vitamin.?e/i, /tocopherol/i],
    severity: 'moderate',
    note: 'High-dose Vitamin E may increase bleeding risk with warfarin.',
  },
  {
    rxNormCodes: ['855288'], // Warfarin
    nonRxNames: [/st\.?.?john/i, /hypericum/i],
    severity: 'contraindicated',
    note: 'St. John\'s Wort is a potent CYP3A4 inducer and significantly reduces warfarin efficacy.',
  },
  {
    rxNormCodes: ['197381', '308460'], // SSRIs (fluoxetine examples)
    nonRxNames: [/st\.?.?john/i, /hypericum/i],
    severity: 'contraindicated',
    note: 'St. John\'s Wort + SSRI risk of serotonin syndrome. Contraindicated.',
  },
  {
    rxNormCodes: [], // Any statin (matched by name below)
    nonRxNames: [/red.?yeast.?rice/i],
    severity: 'major',
    note: 'Red yeast rice contains monacolin K (natural lovastatin). Concurrent use with prescribed statins risks myopathy/rhabdomyolysis.',
  },
];

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function handler(medplum: MedplumClient, event: BotEvent<MedicationRequest>): Promise<void> {
  const rx = event.input;

  if (rx.status !== 'active' && rx.status !== 'draft') return;

  const patientRef = rx.subject?.reference;
  if (!patientRef) return;
  const patientId = patientRef.replace('Patient/', '');

  const rxNormCodes = getRxNormCodes(rx);

  // Load this patient's current non-Rx statements (active/intended)
  const nonRxRecs = await getNonRxRecommendations(medplum, patientId);
  const activeNonRx = nonRxRecs.filter((r) => r.status === 'active' || r.status === 'intended');

  if (activeNonRx.length === 0) return;

  const flagged = detectInteractions(rx, rxNormCodes, activeNonRx);

  if (flagged.length === 0) return;

  // Write interaction flags back onto each affected MedicationStatement
  await applyInteractionFlags(medplum, flagged, rx);

  // Create a Task for the prescribing clinician to review
  await medplum.createResource({
    resourceType: 'Task',
    status: 'requested',
    intent: 'proposal',
    priority: flagged.some((f) => f.severity === 'contraindicated' || f.severity === 'major') ? 'urgent' : 'routine',
    code: {
      coding: [{ system: 'https://medavida.com/fhir/CodeSystem/task-type', code: 'nonrx-interaction-review' }],
    },
    description: buildTaskDescription(flagged),
    focus: createReference(rx),
    for: { reference: `Patient/${patientId}` },
    requester: { reference: 'Device/nonrx-interaction-checker-bot' },
    authoredOn: new Date().toISOString(),
    note: flagged.map((f) => ({ text: `[${f.severity.toUpperCase()}] ${f.nonRxName}: ${f.note}` })),
  });
}

// ─── Detection logic ──────────────────────────────────────────────────────────

interface DetectedInteraction {
  nonRxStatementId: string;
  nonRxName: string;
  severity: InteractionSeverity;
  note: string;
}

function detectInteractions(
  rx: MedicationRequest,
  rxNormCodes: string[],
  nonRxRecs: NonRxMedicationRecommendation[]
): DetectedInteraction[] {
  const rxName = rx.medicationCodeableConcept?.text ?? '';
  const detected: DetectedInteraction[] = [];

  for (const nonRxRec of nonRxRecs) {
    for (const rule of INTERACTION_RULES) {
      const rxMatches =
        rule.rxNormCodes.length === 0 ||
        rule.rxNormCodes.some((code) => rxNormCodes.includes(code));

      if (!rxMatches) continue;

      // Red yeast rice special case: also match Rx name for statin class
      const isStatinRule = rule.nonRxNames.some((r) => r.source.includes('red'));
      if (isStatinRule && !/statin|lovastatin|simvastatin|atorvastatin|rosuvastatin/i.test(rxName)) {
        if (rule.rxNormCodes.length === 0) continue;
      }

      const nonRxMatches = rule.nonRxNames.some((pattern) => pattern.test(nonRxRec.name));
      if (!nonRxMatches) continue;

      // Avoid duplicate flags for the same statement + severity
      const alreadyFlagged = detected.some(
        (d) => d.nonRxStatementId === nonRxRec.patientId && d.severity === rule.severity
      );
      if (alreadyFlagged) continue;

      detected.push({
        nonRxStatementId: nonRxRec.patientId, // populated properly below via search
        nonRxName: nonRxRec.name,
        severity: rule.severity,
        note: rule.note,
      });
    }
  }

  return detected;
}

async function applyInteractionFlags(
  medplum: MedplumClient,
  flagged: DetectedInteraction[],
  rx: MedicationRequest
): Promise<void> {
  for (const flag of flagged) {
    // Find the actual MedicationStatement resource
    const stmts = await medplum.searchResources<MedicationStatement>(
      'MedicationStatement',
      `subject=${rx.subject?.reference}&category=${NON_RX_CATEGORY_SYSTEM}|`
    );

    const stmt = stmts.find((s) => {
      const name = s.medicationCodeableConcept?.text ?? s.medicationCodeableConcept?.coding?.[0]?.display ?? '';
      return new RegExp(escapeRegex(flag.nonRxName), 'i').test(name);
    });

    if (!stmt) continue;

    const existingFlags = (stmt.extension ?? []).filter((e) => e.url === EXT_URLS.INTERACTION_FLAGS);
    const alreadyFlagged = existingFlags.some((e) =>
      e.extension?.some(
        (n) => n.url === EXT_URLS.INTERACTION_FLAG_RX_ID && n.valueString === rx.id
      )
    );

    if (alreadyFlagged) continue;

    await medplum.updateResource<MedicationStatement>({
      ...stmt,
      extension: [
        ...(stmt.extension ?? []),
        {
          url: EXT_URLS.INTERACTION_FLAGS,
          extension: [
            { url: EXT_URLS.INTERACTION_FLAG_RX_ID, valueString: rx.id ?? '' },
            { url: EXT_URLS.INTERACTION_FLAG_SEVERITY, valueCode: flag.severity },
            { url: EXT_URLS.INTERACTION_FLAG_NOTE, valueString: flag.note },
          ],
        },
      ],
      // If contraindicated, move to 'intended' (discussed but paused) pending review
      status: flag.severity === 'contraindicated' ? 'intended' : stmt.status,
    });
  }
}

function buildTaskDescription(flagged: DetectedInteraction[]): string {
  const lines = flagged.map((f) => `• [${f.severity.toUpperCase()}] ${f.nonRxName}`);
  return `Non-Rx interaction check: ${flagged.length} potential interaction(s) detected:\n${lines.join('\n')}`;
}

function getRxNormCodes(rx: MedicationRequest): string[] {
  return (
    rx.medicationCodeableConcept?.coding
      ?.filter((c) => c.system === 'http://www.nlm.nih.gov/research/umls/rxnorm')
      .map((c) => c.code ?? '') ?? []
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Re-export for use by other bots
export { stopNonRxRecommendation };
