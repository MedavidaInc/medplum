import type { BotEvent, MedplumClient } from '@medplum/core';
import type { MedicationRequest } from '@medplum/fhirtypes';

// ─── Bot secrets ─────────────────────────────────────────────────────────────

interface BotSecrets {
  DJANGO_WEBHOOK_URL: string;
  MEDPLUM_WEBHOOK_SECRET: string;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<MedicationRequest>
): Promise<void> {
  const secrets = event.secrets as unknown as BotSecrets;
  const rx = event.input;

  if (!secrets.DJANGO_WEBHOOK_URL) {
    throw new Error('medication-request-bot: DJANGO_WEBHOOK_URL secret is required');
  }
  if (!secrets.MEDPLUM_WEBHOOK_SECRET) {
    throw new Error('medication-request-bot: MEDPLUM_WEBHOOK_SECRET secret is required');
  }

  const response = await fetch(secrets.DJANGO_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/fhir+json',
      'X-Medplum-Signature': secrets.MEDPLUM_WEBHOOK_SECRET,
    },
    body: JSON.stringify(rx),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `medication-request-bot: Django webhook returned ${response.status}: ${body}`
    );
  }

  console.log(
    `medication-request-bot: forwarded MedicationRequest/${rx.id} (status=${rx.status}) to Django`
  );
}
