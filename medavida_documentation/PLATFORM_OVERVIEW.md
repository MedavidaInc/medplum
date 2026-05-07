# MedaVida Platform — Documentation

> Last updated: 2026-05-06

---

## What we are building

A **multi-tenant MSO (Management Services Organization)** platform that services many clinics or groups of clinics, built on a **forked Medplum** FHIR backend with a **custom frontend**.

- Medplum is the headless FHIR backend (dockerized, self-hosted)
- We fork Medplum to add custom bots, extensions, and resource profiles
- We build our own frontend (React / Vite) using `@medplum/react` and `@medplum/core` SDKs
- Primary model: **DPC (Direct Primary Care)** — membership-based, not fee-for-service

**Upstream Medplum repo:** https://github.com/medplum/medplum  
**Our fork:** https://github.com/MedavidaInc/medplum  
**Medplum multi-tenant MSO docs:** https://www.medplum.com/blog/multi-tenant-mso

---

## Architecture decisions

### Multi-tenancy model
- One top-level Medplum `Project` = the MSO
- One child `Project` per clinic (or clinic group) = **bridge model** (shared DB, isolated per-project)
- Extensible: enterprise clinics can be carved out to silo deployments later

### Stack
| Layer | Choice |
|---|---|
| Backend | Forked Medplum (Docker / Kubernetes) |
| Database | PostgreSQL (RDS or self-hosted) |
| Cache / queues | Redis |
| Object storage | S3-compatible |
| Frontend | React / Vite using `@medplum/react` SDK |
| API gateway | Nginx / Caddy / AWS ALB |
| Bot runtime | `awslambda` (or `vmcontext` for self-hosted) |

### Forking strategy
- Fork `medplum/medplum` on GitHub → our fork lives at `MedavidaInc/medplum`
- Keep fork rebased on upstream `main` **monthly** — do NOT diverge core FHIR engine or auth
- Add custom code only in isolated locations:
  - `packages/medavida-bots/` — all custom bot logic
  - `packages/medavida-app/` — custom frontend
- This preserves the ability to pull upstream security patches cleanly

### Extension URL namespace
All custom FHIR extensions use: `https://medavida.com/fhir/StructureDefinition/`  
All custom CodeSystems use: `https://medavida.com/fhir/CodeSystem/`

---

## Repository structure

```
medplum/                          ← fork root
├── packages/
│   ├── medavida-bots/            ← custom bots (DO NOT mix with upstream packages)
│   │   └── src/
│   │       ├── bots/             ← bot handlers + tests
│   │       └── models/           ← FHIR types, builders, profiles
│   ├── medavida-app/             ← custom frontend (DO NOT mix with upstream packages)
│   │   └── src/
│   │       └── pages/
│   │           ├── admin/        ← MSO admin dashboard
│   │           ├── clinic/       ← clinic EMR portal
│   │           └── patient/      ← patient portal
│   └── [upstream packages...]    ← do not modify
├── examples/                     ← upstream examples (do not modify)
├── medavida_documentation/       ← this directory
└── ...
```

---

## Custom packages

### `packages/medavida-bots/` (`@medavida/bots`)

Mirrors the `medplum-demo-bots` pattern: TypeScript compiled with `tsc`, bundled with `esbuild` (CJS output for Lambda/vmcontext), tested with `vitest` + `@medplum/mock`.

**Bots:**

| File | Trigger | Purpose |
|---|---|---|
| `dpc-payment-bot.ts` | `Coverage` subscription (`type=PUBLICPOL`) | DPC membership billing via Stripe — enroll, cancel, update plan, sync status |
| `stripe-webhook-bot.ts` | HTTP POST from Stripe → `Bot/$execute` | Inbound Stripe events → FHIR Coverage + PaymentNotice + Communication |
| `pharmacy-order-bot.ts` | `MedicationRequest?status=active` + inbound webhook | Outbound Rx → pharmacy adapter; inbound status → Task/Dispense/Communication |
| `nonrx-interaction-checker-bot.ts` | `MedicationRequest` creation | Checks patient's non-Rx statements for interactions, creates urgent Task for clinician |

**Models:**

| File | Purpose |
|---|---|
| `models/non-rx-medication.types.ts` | TypeScript types + extension URL constants for non-Rx recommendations |
| `models/non-rx-medication.builder.ts` | FHIR builder, parser, and Medplum client helpers |

### `packages/medavida-app/` (`@medavida/app`)

Mirrors the `medplum-provider` + `medplum-mso-demo` pattern: Vite + React Router v7 + Mantine v8 + `@medplum/react` AppShell.

Three route sections:

| Section | Routes | Purpose |
|---|---|---|
| MSO Admin | `/admin`, `/admin/clinics`, `/admin/clinics/:id` | Multi-clinic dashboard, org management |
| Clinic EMR | `/clinic/patients`, `/clinic/tasks`, `/clinic/messages`, `/clinic/pharmacy`, `/clinic/patients/:id/non-rx` | Provider-facing EHR portal |
| Patient Portal | `/portal`, `/portal/membership` | Member self-service, DPC plan status |

---

## Required secrets

| Secret key | Used by | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | dpc-payment-bot | Stripe live/test key |
| `STRIPE_PRICE_INDIVIDUAL` | dpc-payment-bot | Stripe Price ID for individual plan |
| `STRIPE_PRICE_FAMILY` | dpc-payment-bot | Stripe Price ID for family plan |
| `STRIPE_PRICE_SENIOR` | dpc-payment-bot | Stripe Price ID for senior plan |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook-bot | Stripe webhook signing secret |
| `PHARMACY_ADAPTER_URL` | pharmacy-order-bot | Your adapter base URL |
| `PHARMACY_ADAPTER_API_KEY` | pharmacy-order-bot | Adapter auth key |
| `CLINIC_DEFAULT_NPI` | pharmacy-order-bot | Fallback NPI when prescriber NPI is absent |

Secrets are set via `Bot.secret[]` in Medplum and injected as `process.env` in the `awslambda` runtime.

---

## What still needs to be built

### High priority
- [ ] **Frontend pages — flesh out** — PatientPage tabs, Encounter documentation UI, Non-Rx add/edit form
- [ ] **MSO / clinic org hierarchy models** — `Organization` + `OrganizationAffiliation` profiles for MSO → clinic group → clinic
- [ ] **DPC membership plan models** — `Coverage` profile extensions for tier, billing cycle, included services
- [ ] **Provider credentialing models** — `Practitioner` + `PractitionerRole` extensions for NPI, DEA, state licenses

### Medium priority
- [ ] **Pharmacy adapter microservice** — translates `OutboundPrescriptionPayload` to DoseSpot / Surescripts / retail APIs
- [ ] **FHIR StructureDefinitions + ValueSets** — register non-Rx profile and ValueSets in Medplum
- [ ] **SearchParameter for stripe-subscription-id** — enables efficient `Coverage` lookup by Stripe ID

### Lower priority
- [ ] **Care coordination / referral tracking** — `ServiceRequest` + `Task` workflow for referrals between clinics
- [ ] **Deployment — Helm chart customization** — extend Medplum's Helm chart for MSO-specific config
- [ ] **CI/CD pipeline** — GitHub Actions: build fork → run bot tests → deploy to staging → promote to prod

---

## Things to replace before production

- `https://medavida.com/fhir/...` → verify this is your actual domain (or replace globally if not)
- Stripe Price IDs → real IDs from your Stripe dashboard
- `CLINIC_DEFAULT_NPI` → your clinic's actual NPI
- `PHARMACY_ADAPTER_URL` → real adapter URL when built

---

## Maintaining the fork

### Git remotes
```
origin    https://github.com/MedavidaInc/medplum.git   ← our fork
upstream  https://github.com/medplum/medplum.git        ← Medplum upstream
```

### Monthly rebase workflow
```sh
git fetch upstream
git rebase upstream/main
# resolve any conflicts (should only be root config files)
npm test
# if @medplum/* versions bumped, update package.json in medavida-bots and medavida-app
npm install
git push origin main
```

### What NOT to modify in upstream packages
- `packages/server/` — core FHIR engine
- `packages/core/`, `packages/react/`, `packages/fhirtypes/` — SDKs we depend on
- Auth and access policy logic

If a patch to upstream code is needed, open a PR to `medplum/medplum` first. If urgent, isolate and document the patch so it can be dropped after the upstream fix merges.

---

## Running locally

```sh
# Bots
cd packages/medavida-bots
npm install
npm test          # vitest with @medplum/mock — no real API calls
npm run build     # tsc + esbuild → dist/

# App
cd packages/medavida-app
npm install
npm run dev       # Vite dev server on localhost:3001
npm run build     # production build
```

---

## Reference links

- Medplum docs: https://www.medplum.com/docs
- Medplum bot examples (Stripe): https://github.com/medplum/medplum/tree/main/examples/medplum-demo-bots/src/stripe-bots
- Medplum DoseSpot integration: https://www.medplum.com/docs/integration/dosespot/getting-started
- FHIR R4 MedicationStatement: https://www.hl7.org/fhir/medicationstatement.html
- NIH DSLD (supplement database): https://dsld.nlm.nih.gov
- HPUS (homeopathic codes): https://www.hpus.com
- Stripe webhook events: https://stripe.com/docs/api/events/types
