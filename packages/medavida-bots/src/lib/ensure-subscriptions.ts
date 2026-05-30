/**
 * Ensures all required Medplum Subscriptions exist for the MedaVida project.
 *
 * Run after every Medplum deploy or restart to guarantee the Django webhook
 * pipeline is wired up. Idempotent — skips subscriptions that already exist.
 *
 * Usage (via CI workflow step):
 *   node dist/lib/ensure-subscriptions.js
 *
 * Required env vars:
 *   MEDPLUM_BASE_URL         e.g. https://medplum.staging.medavida.app
 *   MEDPLUM_CLIENT_ID        backend ClientApplication ID
 *   MEDPLUM_CLIENT_SECRET    backend ClientApplication secret
 *   DJANGO_WEBHOOK_URL       e.g. https://api.staging.medavida.app/api/emr/webhook/medplum/
 *   MEDPLUM_WEBHOOK_SECRET   shared secret matching Django MEDPLUM_WEBHOOK_SECRET
 */

import type { Subscription } from '@medplum/fhirtypes';

// Each entry: [criteria, human-readable reason]
const REQUIRED_SUBSCRIPTIONS: [string, string][] = [
  ['Patient',           'Sync Patient creates/updates to Django'],
  ['MedicationRequest', 'Sync MedicationRequest creates/updates to Django'],
  ['MedicationDispense','Sync MedicationDispense (shipments) to Django'],
  [
    'Basic?code=https://medavida.com/fhir/CodeSystem/resource-type|MedicationDelivery',
    'Sync Basic/MedicationDelivery status updates to Django',
  ],
];

async function getToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
  });
  if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status} ${await resp.text()}`);
  const data = (await resp.json()) as { access_token: string };
  return data.access_token;
}

async function searchSubscriptions(baseUrl: string, token: string, criteria: string): Promise<number> {
  const url = `${baseUrl}/fhir/R4/Subscription?criteria=${encodeURIComponent(criteria)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
  const bundle = (await resp.json()) as { total?: number; entry?: unknown[] };
  return bundle.total ?? bundle.entry?.length ?? 0;
}

async function createSubscription(
  baseUrl: string,
  token: string,
  criteria: string,
  reason: string,
  webhookUrl: string,
  webhookSecret: string,
): Promise<void> {
  const sub: Subscription = {
    resourceType: 'Subscription',
    status: 'active',
    reason,
    criteria,
    channel: {
      type: 'rest-hook',
      endpoint: webhookUrl,
      payload: 'application/fhir+json',
      header: [`X-Medplum-Signature: ${webhookSecret}`],
    },
  };
  const resp = await fetch(`${baseUrl}/fhir/R4/Subscription`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/fhir+json' },
    body: JSON.stringify(sub),
  });
  if (!resp.ok) throw new Error(`Create failed: ${resp.status} ${await resp.text()}`);
}

async function main(): Promise<void> {
  const baseUrl       = process.env['MEDPLUM_BASE_URL']       ?? '';
  const clientId      = process.env['MEDPLUM_CLIENT_ID']      ?? '';
  const clientSecret  = process.env['MEDPLUM_CLIENT_SECRET']  ?? '';
  const webhookUrl    = process.env['DJANGO_WEBHOOK_URL']     ?? '';
  const webhookSecret = process.env['MEDPLUM_WEBHOOK_SECRET'] ?? '';

  if (!baseUrl || !clientId || !clientSecret || !webhookUrl || !webhookSecret) {
    console.error('Missing required environment variables.');
    process.exit(1);
  }

  const token = await getToken(baseUrl, clientId, clientSecret);
  console.log('Ensuring Medplum Subscriptions...');

  for (const [criteria, reason] of REQUIRED_SUBSCRIPTIONS) {
    const count = await searchSubscriptions(baseUrl, token, criteria);
    if (count > 0) {
      console.log(`  [skip]    ${criteria}`);
      continue;
    }
    await createSubscription(baseUrl, token, criteria, reason, webhookUrl, webhookSecret);
    console.log(`  [created] ${criteria}`);
  }

  console.log('Done.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});