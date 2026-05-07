# MSO Platform — Project Context

> Paste this file at the start of any new Claude session to resume work.
> Last updated: 2026-05-06

---

## What we are building

A **multi-tenant MSO (Management Services Organization)** platform that services many clinics or groups of clinics, built on a **forked Medplum** FHIR backend with a **custom frontend**.

- Medplum is the headless FHIR backend (dockerized, self-hosted)
- We fork Medplum to add custom bots, extensions, and resource profiles
- We build our own frontend (React / Next.js) using `@medplum/react` and `@medplum/core` SDKs
- Primary model: **DPC (Direct Primary Care)** — membership-based, not fee-for-service

**Medplum repo:** https://github.com/medplum/medplum
**Medplum multi-tenant MSO docs:** https://www.medplum.com/blog/multi-tenant-mso

---

## Architecture decisions made

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
| Frontend | React / Next.js using `@medplum/react` SDK |
| API gateway | Nginx / Caddy / AWS ALB |
| Bot runtime | `awslambda` (or `vmcontext` for self-hosted) |

### Forking strategy
- Fork `medplum/medplum` on GitHub
- Keep fork rebased on upstream `main` monthly — do NOT diverge core FHIR engine or auth
- Add custom code only in isolated locations:
  - `packages/custom-bots/src/` — all custom bot logic
  - `packages/custom-models/src/` — FHIR extensions, profiles, ValueSets
- This preserves ability to pull upstream security patches cleanly

### Extension URL namespace
All custom FHIR extensions use: `https://your-mso.com/fhir/StructureDefinition/`
Replace `your-mso.com` with your actual domain before deploying.

---

## Files built so far

### Custom bots — `packages/custom-bots/src/`

#### `dpc-payment-bot.ts`
- **Trigger:** FHIR Subscription on `Coverage` resource (criteria: `Coverage?type=...PUBLICPOL`)
- **Purpose:** DPC membership billing via Stripe
- **Actions:** enroll (create Stripe Customer + Subscription), cancel (cancel at period end), update_plan (upgrade/downgrade with proration), sync_status (reconcile invoice state)
- **FHIR writes:** `PaymentNotice` for every billing event; Stripe IDs written back as extensions on `Patient` and `Coverage`
- **Required secrets:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_INDIVIDUAL`, `STRIPE_PRICE_FAMILY`, `STRIPE_PRICE_SENIOR`

#### `pharmacy-order-bot.ts`
- **Trigger (outbound):** FHIR Subscription on `MedicationRequest?status=active`
- **Trigger (inbound):** HTTP webhook POST from pharmacy adapter to `Bot/{id}/$execute`
- **Purpose:** Generic pharmacy order management — network-agnostic, adapter pattern
- **Outbound:** Builds normalized `OutboundPrescriptionPayload`, POSTs to adapter, creates `Task` to track order lifecycle
- **Inbound:** Maps pharmacy status → FHIR `MedicationRequest` status + `Task` update + `Communication` alert if clinician action needed + `MedicationDispense` on dispensing
- **Required secrets:** `PHARMACY_ADAPTER_URL`, `PHARMACY_ADAPTER_API_KEY`, `CLINIC_DEFAULT_NPI`
- **Note:** The pharmacy adapter is a separate microservice you build to translate to DoseSpot / Surescripts / retail APIs. Bot stays network-agnostic.

### Custom models — `packages/custom-models/src/`

#### `types/non-rx-medication.types.ts`
- Full TypeScript type definitions for non-prescription medication recommendations
- Covers: vitamins/supplements, herbal/botanicals, homeopathic products, medical foods
- Key types: `NonRxMedicationRecommendation`, `ProductClassification`, `ClinicalContext`, `MedicationInteractionFlag`, `PurchaseSourcing`, `AdherenceTracking`
- All extension URLs defined as constants in `EXT_URLS`
- Coding systems per category: RxNorm + NIH DSLD (vitamins), NAPRALERT + SNOMED (herbals), HPUS (homeopathic), FDA UNII (medical foods)

#### `non-rx-medication.builder.ts`
- Builder: `buildNonRxMedicationStatement()` → typed struct to FHIR `MedicationStatement`
- Category concept builders: `buildVitaminConcept()`, `buildHerbalConcept()`, `buildHomeopathicConcept()`, `buildMedicalFoodConcept()`
- Parser: `parseNonRxMedicationStatement()` → FHIR back to typed struct
- Medplum client helpers: `createNonRxRecommendation()`, `getNonRxRecommendations()`, `getInteractionsForRx()`, `stopNonRxRecommendation()`

#### `profiles/NonRxMedicationStatement.StructureDefinition.json`
- FHIR StructureDefinition profiling `MedicationStatement` for non-Rx use
- Key constraints: `category` required (our MSO CodeSystem), `informationSource` must be `Practitioner`, `medicationCodeableConcept` only (no `medicationReference`)
- POST to `/fhir/R4/StructureDefinition` to register in Medplum

#### `profiles/ValueSets.json`
- 7 ValueSets to load: `non-rx-category`, `evidence-grade`, `interaction-severity`, `purchase-source`, `non-rx-product-form`, `botanical-part`, `third-party-test-org`
- POST each to `/fhir/R4/ValueSet`

---

## Key design decisions for the non-Rx model

- Uses `MedicationStatement` (not `MedicationRequest`) — no prescriber/DEA context needed
- `status: 'intended'` = discussed but not started (e.g. flagged interaction)
- `status: 'stopped'` = discontinued, with `discontinuedReason` extension
- `category` field (MSO CodeSystem) is the discriminator that separates these from regular Rx `MedicationStatement` resources in queries
- Interaction flags live as nested complex extensions on the statement itself — each references a `MedicationRequest` ID with severity + note
- `thirdPartyTested` + `thirdPartyTestOrg` fields capture USP/NSF/ConsumerLab verification — relevant for patient safety

---

## What still needs to be built

### High priority
- [ ] **NonRx interaction checker bot** — fires on `MedicationRequest` creation, queries patient's non-Rx statements, surfaces interaction flags to prescribing clinician
- [ ] **Frontend — clinic EMR portal** — Next.js app using `@medplum/react`, custom UX for DPC workflow
- [ ] **Frontend — patient portal** — membership management, visit history, messaging
- [ ] **Frontend — MSO admin dashboard** — multi-clinic view, billing oversight, analytics
- [ ] **Stripe webhook handler** — inbound events from Stripe (payment_failed, invoice.paid, subscription.deleted) back into FHIR

### Medium priority
- [ ] **Pharmacy adapter microservice** — translates generic `OutboundPrescriptionPayload` to DoseSpot / Surescripts / retail APIs
- [ ] **MSO / clinic org hierarchy models** — `Organization` + `OrganizationAffiliation` profiles for MSO → clinic group → clinic structure
- [ ] **DPC membership plan models** — `Coverage` profile extensions for tier, billing cycle, included services
- [ ] **Provider credentialing models** — `Practitioner` + `PractitionerRole` extensions for NPI, DEA, state licenses, contract terms

### Lower priority
- [ ] **Care coordination / referral tracking** — `ServiceRequest` + `Task` workflow for referrals between clinics in the MSO
- [ ] **Deployment — Helm chart customization** — extend Medplum's Helm chart for MSO-specific config
- [ ] **CI/CD pipeline** — GitHub Actions: build fork → run bot tests → deploy to staging → promote to prod

---

## Suggested next session prompts

To continue a specific area, start your session with this file and then say:

- *"Let's build the NonRx interaction checker bot"*
- *"Let's build the Stripe webhook handler bot"*
- *"Let's design the frontend clinic EMR portal — start with the component architecture"*
- *"Let's build the MSO org hierarchy FHIR models"*
- *"Let's build the pharmacy adapter microservice"*
- *"Let's set up the CI/CD pipeline for the fork"*

---

## Secrets reference

| Secret key | Used by | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | dpc-payment-bot | Stripe live/test key |
| `STRIPE_PRICE_INDIVIDUAL` | dpc-payment-bot | Stripe Price ID |
| `STRIPE_PRICE_FAMILY` | dpc-payment-bot | Stripe Price ID |
| `STRIPE_PRICE_SENIOR` | dpc-payment-bot | Stripe Price ID |
| `PHARMACY_ADAPTER_URL` | pharmacy-order-bot | Your adapter base URL |
| `PHARMACY_ADAPTER_API_KEY` | pharmacy-order-bot | Adapter auth key |
| `CLINIC_DEFAULT_NPI` | pharmacy-order-bot | Fallback NPI |

Secrets are set via `Bot.secret[]` in Medplum and injected as `process.env` in the `awslambda` runtime.

---

## Things to replace before going to production

- `https://your-mso.com/fhir/...` → your actual domain in all extension URLs
- `https://your-mso.com/fhir/CodeSystem/...` → your actual domain in all ValueSets and StructureDefinitions
- Stripe Price IDs → real IDs from your Stripe dashboard
- `CLINIC_DEFAULT_NPI` → your clinic's actual NPI
- `PHARMACY_ADAPTER_URL` → real adapter URL when built

---

## Reference links

- Medplum docs: https://www.medplum.com/docs
- Medplum bot examples (Stripe): https://github.com/medplum/medplum/tree/main/examples/medplum-demo-bots/src/stripe-bots
- Medplum DoseSpot integration docs: https://www.medplum.com/docs/integration/dosespot/getting-started
- FHIR R4 MedicationStatement: https://www.hl7.org/fhir/medicationstatement.html
- NIH DSLD (supplement database): https://dsld.nlm.nih.gov
- HPUS (homeopathic codes): https://www.hpus.com
