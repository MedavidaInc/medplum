# MedaVida Bots

Custom Medplum bots and shared utilities for the MedaVida platform.

## Overview

This package lives in the `MedavidaInc/medplum` fork under `packages/medavida-bots/`. It contains:

- **Bots** — serverless functions that run inside Medplum in response to FHIR resource events
- **Shared libraries** — utilities shared across bots (Stripe status mapping, subscription upsert)
- **FHIR model builders** — TypeScript types and builder/parser pairs for custom `Basic` resources read by the React frontend

---

## Bots

### `dpc-payment-bot`

**Trigger:** Medplum Subscription on `Coverage` resources with `type.coding[0].code = PUBLICPOL`

**Purpose:** Manages DPC (Direct Primary Care) membership billing via Stripe. When a clinician creates or updates a `Coverage` resource with the DPC type, this bot calls Stripe to enroll, cancel, or update the patient's subscription plan.

**Actions:**
| action | What it does |
|---|---|
| `enroll` | Creates a Stripe customer + subscription, stores IDs as extensions on the Coverage |
| `cancel` | Cancels the Stripe subscription |
| `update_plan` | Changes the Stripe price (individual / family / senior) |
| `sync_status` | Reads current Stripe status and writes a `PaymentNotice` back to Medplum |

**Secrets required:**
| Secret | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_PRICE_INDIVIDUAL` | Stripe Price ID for individual DPC plan |
| `STRIPE_PRICE_FAMILY` | Stripe Price ID for family DPC plan |
| `STRIPE_PRICE_SENIOR` | Stripe Price ID for senior DPC plan |

---

### `stripe-webhook-bot`

**Trigger:** Called by Django (`execute_bot`) when Stripe sends webhook events to the Django endpoint

**Purpose:** Keeps Medplum FHIR Coverage resources in sync with Stripe subscription lifecycle events (payment success, failure, cancellation).

**Handled events:**
| Stripe event | Action |
|---|---|
| `invoice.paid` | Sets Coverage status → `active` |
| `invoice.payment_failed` | Sets Coverage status → `draft` |
| `customer.subscription.deleted` | Sets Coverage status → `cancelled` |
| `customer.subscription.updated` | Syncs Coverage status to new Stripe status |

**Secrets required:**
| Secret | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key |

---

### `pharmacy-order-bot`

**Trigger:** Medplum Subscription on `MedicationRequest` resources

**Purpose:** Forwards outbound prescription orders to an external pharmacy adapter service and handles inbound pharmacy status updates. Writes `MedicationDispense` resources back to Medplum when a shipment is confirmed.

**Secrets required:**
| Secret | Description |
|---|---|
| `PHARMACY_ADAPTER_URL` | Base URL of the pharmacy adapter service |
| `PHARMACY_API_KEY` | API key for the pharmacy adapter |

---

### `medication-request-bot`

**Trigger:** Medplum Subscription on `MedicationRequest` resources with `category.coding[0].code = substance-request`

**Purpose:** Forwards `MedicationRequest` events to the Django webhook so Django can create or update `SubstanceRequest` records. Acts as a bridge — Medplum fires the subscription, the bot POSTs the raw FHIR resource body to Django with the shared secret header.

**Secrets required:**
| Secret | Description |
|---|---|
| `DJANGO_WEBHOOK_URL` | Django webhook endpoint, e.g. `https://api.staging.medavida.app/api/emr/webhook/medplum/` |
| `MEDPLUM_WEBHOOK_SECRET` | Shared secret matching `MEDPLUM_WEBHOOK_SECRET` in Django settings |

> **Note:** The Bot resource ID is `TBD` in `medplum.config.json`. After creating the Bot in the Medplum UI, update the `id` field and redeploy.

---

## Shared Libraries

### `src/lib/stripe-utils.ts`

Maps Stripe subscription statuses to FHIR `Coverage.status` values. Used by both `dpc-payment-bot` and `stripe-webhook-bot`.

### `src/lib/ensure-subscriptions.ts`

Post-deploy script that upserts all four required Medplum Subscriptions. Run automatically by the CI workflow after every bot deploy. Idempotent — skips any subscription that already exists.

**Required Medplum Subscriptions** (all pointing to the Django webhook):

| Criteria | Purpose |
|---|---|
| `Patient` | Inbound: new/updated patients sync to Django |
| `MedicationRequest` | Inbound: MedicationRequests (care plan + substance requests) sync to Django |
| `MedicationDispense` | Inbound: Evitalin shipment confirmations sync to Django |
| `Basic?code=...MedicationDelivery` | Inbound: delivery status updates sync to Django |

---

## FHIR Model Builders (`src/models/`)

TypeScript types and builder/parser pairs for custom `Basic` resources. These are used by the React frontend to read MedaVida-specific data from Medplum using standard Medplum auth.

| Files | Resource | Description |
|---|---|---|
| `patient-subscription.types.ts` / `.builder.ts` | `Basic/PatientSubscription` | A patient's recurring substance subscription (billing interval, status, bundled substances). Written by Django on every Subscription save. |
| `patient-inventory.types.ts` / `.builder.ts` | `Basic/PatientInventory` | Estimated on-hand quantity of a catalogue item for a patient. Written by Django when inventory changes. |
| `medication-delivery.types.ts` / `.builder.ts` | `Basic/MedicationDelivery` | Physical delivery record for a dispensed medication. Written by Django when delivery status changes. |

**React query pattern:**
```ts
// Get all PatientSubscription records for a patient
const bundle = await medplum.search('Basic', {
  code: 'https://medavida.com/fhir/CodeSystem/resource-type|PatientSubscription',
  subject: `Patient/${patientId}`,
});
```

---

## CI / CD

### Workflow: `deploy-medavida-bots.yml`

**Triggers:**
- Push to `main` when files under `packages/medavida-bots/src/**` change
- Manual `workflow_dispatch` (optionally targeting a single bot)

**Steps:**
1. Install dependencies (`npm ci`)
2. Build all bots (`npm run build`) — esbuild bundles each bot + lib into `dist/`
3. Obtain a Medplum access token via `client_credentials`
4. Upload each bot's compiled JS as a `Binary` resource and update the `Bot.executableCode` reference
5. **Ensure Medplum Subscriptions** — runs `node dist/lib/ensure-subscriptions.js` to create any missing subscriptions

**GitHub Secrets required:**

| Secret | Description |
|---|---|
| `MEDPLUM_STAGING_CLIENT_ID` | Backend `ClientApplication` ID (`6e5f62ba-...`) |
| `MEDPLUM_STAGING_CLIENT_SECRET` | Backend `ClientApplication` secret |
| `MEDPLUM_STAGING_WEBHOOK_SECRET` | Shared webhook secret (matches Django `MEDPLUM_WEBHOOK_SECRET` and Medplum Subscription channel header) |

---

## Initial Setup (first deploy to a new environment)

### 1. Create the Medplum project

Log in to the Medplum UI (`https://medplum.staging.medavida.app`) as Super Admin (`admin@example.com`). Create a project named **MedaVida**.

### 2. Create ClientApplications

Inside the MedaVida project, create two `ClientApplication` resources:

| Name | Grant type | Redirect URI | Purpose |
|---|---|---|---|
| `MedaVida Backend` | `client_credentials` | — | Django backend service account |
| `MedaVida SPA` | `authorization_code` | `https://app.staging.medavida.app/` | React frontend |

Note the `id` and `secret` for each. Store them in:
- AWS Secrets Manager (`medavida/staging/app`): `MEDPLUM_CLIENT_ID`, `MEDPLUM_CLIENT_SECRET`
- Frontend `config.json` on S3: `MEDPLUM_CLIENT_ID` (SPA client ID)
- GitHub Secrets: `MEDPLUM_STAGING_CLIENT_ID`, `MEDPLUM_STAGING_CLIENT_SECRET`

### 3. Create Bot resources

In the Medplum UI, create a `Bot` resource for each bot listed in `medplum.config.json`. Set `runtimeVersion: vmcontext`. Note the UUIDs and update `medplum.config.json` accordingly.

Set secrets on each Bot resource (via the Bot detail page → Secrets tab).

### 4. Invite the demo user

Admin → Project → Invite:
- Email: `demo@medavida.com`
- Password: `MedaVida2026!`
- Role: Practitioner

Or run `./scripts/seed_staging.sh` from the `medavida-backend` repo (handles this automatically).

### 5. Deploy bots

Push to `main` or trigger `workflow_dispatch`. The CI workflow will deploy all bots and create all required Medplum Subscriptions automatically.

### 6. Verify

After deploy, confirm in the Medplum UI (Admin → Subscriptions) that all four subscriptions exist and are `active`. Create a test `Patient` resource and verify it appears in the Django admin within a few seconds.

---

## Development

```bash
cd packages/medavida-bots
npm ci
npm run build      # compile all bots and libs
npm test           # run vitest unit tests
npm run lint       # eslint
```

Bot handlers are pure functions that receive a `MedplumClient` and a `BotEvent`. Tests use `MockClient` from `@medplum/mock` to simulate FHIR reads/writes without hitting a real server.

> **MockClient limitation:** `upsertResource` is not implemented in `MockClient`. Tests that cover upsert paths mock it explicitly: `vi.spyOn(medplum, 'upsertResource').mockResolvedValue(...)`.