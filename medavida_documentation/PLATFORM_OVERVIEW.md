# MedaVida Platform — Documentation

> Last updated: 2026-05-11

---

## What We Are Building

A **DPC (Direct Primary Care)** practice management platform built on a **forked Medplum** self-hosted FHIR server with a custom Django backend and React frontend.

- **Medplum** — headless FHIR server (self-hosted on ECS Fargate, v5.1.10)
- **Django** — orchestration engine: subscriptions, billing, supplier submission, inventory
- **React SPA** — practice dashboard (`MedavidaInc/Medavidapracticedashboard`)
- **Medplum Bots** — automation layer in this repo (`packages/medavida-bots/`)

**Our fork:** https://github.com/MedavidaInc/medplum  
**Django backend:** https://github.com/MedavidaInc/medavida-backend  
**React frontend:** https://github.com/MedavidaInc/Medavidapracticedashboard

---

## System Architecture

```
React Frontend (app.staging.demoatable.com)
    │ primary API          │ secondary API
    ▼                      ▼
Medplum FHIR Server    Django REST API
(medplum.staging.*)    (api.staging.*)
    │ webhooks                │ Celery tasks
    │                         │
    ▼                         ▼
Medplum Bots ◄──────── Stripe Webhooks
(this repo)            (forwarded by Django)
```

**Key principle:** The React frontend uses Medplum as its primary data API. Django is called only for payment operations and subscription management. Everything clinical — patients, prescriptions, invoices, inventory, deliveries — is written back from Django to Medplum so the frontend always has a complete picture.

---

## Staging Environment

| Service | URL |
|---|---|
| React Frontend | `https://app.staging.demoatable.com` |
| Django API | `https://api.staging.demoatable.com` |
| Medplum FHIR | `https://medplum.staging.demoatable.com` |

**Demo credentials:** `demo@medavida.com` / `MedaVida2026!`

See [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md) for full infrastructure details.

---

## Repository Structure

```
medplum/                              ← MedaVida fork of medplum/medplum
├── packages/
│   ├── medavida-bots/                ← ALL custom bot code lives here
│   │   ├── src/
│   │   │   ├── bots/                 ← bot handlers
│   │   │   └── models/               ← FHIR builders, types
│   │   ├── medplum.config.json       ← bot IDs (staging)
│   │   └── package.json
│   └── [upstream packages...]        ← do not modify
├── medavida_documentation/           ← this directory
├── .github/workflows/
│   ├── deploy-medavida-bots.yml      ← MedaVida bot CI/CD (auto-deploy on src change)
│   └── [upstream workflows...]
└── ...
```

---

## Custom Bots (`packages/medavida-bots/`)

Bot runtime: **`vmcontext`** (self-hosted Medplum — not `awslambda`).

| Bot | Trigger | Purpose |
|---|---|---|
| `dpc-payment-bot` | `Coverage` subscription (`type=PUBLICPOL`) | DPC membership billing — enroll, cancel, plan change, sync status |
| `stripe-webhook-bot` | `Bot/$execute` POST from Django | Stripe billing events → FHIR Coverage + PaymentNotice + Communication |
| `pharmacy-order-bot` | `MedicationRequest?status=active` + inbound webhook | Outbound Rx → pharmacy adapter; inbound status → Task/Dispense/Communication |

### Deployed bot IDs (staging — MedaVida project `d75b420c`)

| Bot | ID |
|---|---|
| `stripe-webhook-bot` | `3f531da1-2312-4b7d-88a9-aee9956eb652` |
| `dpc-payment-bot` | `f65f3639-8518-4842-bf15-aefaf365687f` |
| `pharmacy-order-bot` | `a3a83673-fab7-47c8-9a35-8248ea03b7e8` |

IDs are also stored in `packages/medavida-bots/medplum.config.json`.

### Bot secrets (set on each Bot resource in Medplum admin UI)

| Secret | Bot | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | dpc-payment-bot, stripe-webhook-bot | Stripe API key |
| `STRIPE_PRICE_INDIVIDUAL` | dpc-payment-bot | Stripe Price ID |
| `STRIPE_PRICE_FAMILY` | dpc-payment-bot | Stripe Price ID |
| `STRIPE_PRICE_SENIOR` | dpc-payment-bot | Stripe Price ID |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook-bot | Stripe webhook signing secret |
| `PHARMACY_ADAPTER_URL` | pharmacy-order-bot | Adapter base URL |
| `PHARMACY_ADAPTER_API_KEY` | pharmacy-order-bot | Adapter auth key |
| `CLINIC_DEFAULT_NPI` | pharmacy-order-bot | Fallback NPI when prescriber absent |

---

## CI/CD — Bot Auto-Deploy

Bots are automatically deployed to staging when source files change.

**Workflow:** `.github/workflows/deploy-medavida-bots.yml`  
**Triggers:** Push to `main` touching `packages/medavida-bots/src/**` (or esbuild script, package.json, or the workflow file itself)  
**Manual trigger:** GitHub Actions UI — deploy all bots or a single named bot

**Required GitHub secrets** (set on `MedavidaInc/medplum`):

| Secret | Value source |
|---|---|
| `MEDPLUM_STAGING_CLIENT_ID` | `medavida/staging/app` → `MEDPLUM_CLIENT_ID` in AWS Secrets Manager |
| `MEDPLUM_STAGING_CLIENT_SECRET` | `medavida/staging/app` → `MEDPLUM_CLIENT_SECRET` in AWS Secrets Manager |

**What the workflow does:**
1. `npm ci` + `npm run build` (esbuild → `dist/bots/`)
2. Gets a Medplum `client_credentials` access token
3. For each bot: `POST /fhir/R4/Binary` with the compiled JS, then `PUT /fhir/R4/Bot/<id>` with `executableCode.url = "Binary/<id>"`
4. Bot IDs are read from `medplum.config.json` at runtime

---

## Extension URL Namespace

All custom FHIR extensions: `https://medavida.com/fhir/StructureDefinition/`  
All custom CodeSystems: `https://medavida.com/fhir/CodeSystem/`

---

## Forking Strategy

- Fork lives at `MedavidaInc/medplum` — upstream at `medplum/medplum`
- Rebase on upstream `main` **monthly** — never diverge core FHIR engine or auth
- Custom code only in `packages/medavida-bots/` — never modify upstream packages
- All custom workflows prefixed `deploy-medavida-*` to avoid conflicts with upstream CI

### Monthly rebase

```sh
git fetch upstream
git rebase upstream/main
# resolve conflicts (usually only root config files)
npm test
git push origin main
```

---

## Running Locally

```sh
# Bot tests (no running server needed — uses @medplum/mock)
cd packages/medavida-bots
npm install
npm test

# Build bots
npm run build   # outputs to dist/bots/
```

See [LOCAL_LAUNCH.md](LOCAL_LAUNCH.md) for running the full Medplum server locally.

---

## Reference Links

- Medplum docs: https://www.medplum.com/docs
- FHIR R4 spec: https://hl7.org/fhir/R4/
- Stripe webhook events: https://stripe.com/docs/api/events/types
- Django backend docs: `medavida-backend/docs/`