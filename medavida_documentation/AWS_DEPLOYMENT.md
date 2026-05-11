# MedaVida — AWS Deployment Guide

> Last updated: 2026-05-11  
> Stack: ECS Fargate + RDS PostgreSQL + ElastiCache Redis + S3 + ALB + CloudFront  
> IaC: Terraform (`medavida-backend/terraform/`)  
> CI/CD: GitHub Actions — all three components deploy automatically on push to `main`

---

## Architecture Overview

```
Internet
    │
    ├── app.staging.demoatable.com ──→ [CloudFront E3R58DCVIHYD5Y]
    │                                        │
    │                                        ▼
    │                                  [S3: medavida-staging-frontend]
    │
    ├── api.staging.demoatable.com ──→ [ALB] ──→ [ECS: medavida-web / medavida-worker]
    │                                                    │
    └── medplum.staging.demoatable.com → [ALB] ──→ [ECS: medavida-medplum]
                                                         │
                                            ┌────────────┼────────────┐
                                            ▼            ▼            ▼
                                     [RDS Postgres] [Redis]    [S3 binaries]
```

---

## AWS Resources — Staging

| Resource | Name / ID | Region |
|---|---|---|
| ECS Cluster | `medavida` | us-east-2 |
| ECS Service (web) | `medavida-web` (task def: `medavida-web:11`) | us-east-2 |
| ECS Service (worker) | `medavida-worker` | us-east-2 |
| ECS Service (medplum) | `medavida-medplum` (task def: `medavida-medplum:11`) | us-east-2 |
| ECR (Django) | `medavida-django` | us-east-2 |
| ECR (Medplum) | `medavida-medplum` | us-east-2 |
| RDS (PostgreSQL) | `medavida-staging.czsg0qgye6mw.us-east-2.rds.amazonaws.com:5432` | us-east-2 |
| ElastiCache (Redis) | `medavida-staging.eghfw4.0001.use2.cache.amazonaws.com:6379` | us-east-2 |
| S3 (frontend) | `medavida-staging-frontend` | us-east-2 |
| S3 (Medplum binaries) | `medavida-staging-binaries` | us-east-2 |
| CloudFront (frontend) | `E3R58DCVIHYD5Y` | global |
| Secrets Manager (app) | `medavida/staging/app` | us-east-2 |
| Secrets Manager (db) | `medavida/staging/db-password` | us-east-2 |
| AWS Profile | `medavida` | — |

---

## Secrets Manager — `medavida/staging/app`

Flat JSON object injected as individual environment variables into ECS tasks.

| Key | Notes |
|---|---|
| `SECRET_KEY` | Django secret key |
| `DATABASE_URL` | Full `postgres://` connection string — authoritative password source |
| `REDIS_URL` | Redis connection string |
| `STRIPE_TEST_SECRET_KEY` | Stripe test key (`sk_test_...`) |
| `STRIPE_ENDPOINT_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `FRONT_END_ROOT_URL` | `https://app.staging.demoatable.com` |
| `MEDPLUM_WEBHOOK_SECRET` | HMAC secret for inbound Medplum webhooks |
| `MEDPLUM_BASE_URL` | `https://medplum.staging.demoatable.com/` |
| `MEDPLUM_TOKEN_URL` | `https://medplum.staging.demoatable.com/oauth2/token` |
| `MEDPLUM_CLIENT_ID` | Django backend `ClientApplication` ID |
| `MEDPLUM_CLIENT_SECRET` | Django backend `ClientApplication` secret |
| `MEDPLUM_STRIPE_WEBHOOK_BOT_ID` | `3f531da1-2312-4b7d-88a9-aee9956eb652` |

> `DATABASE_URL` contains the authoritative DB password. Do not rely on `medavida/staging/db-password` — it has drifted.

---

## Deploying the Django Backend

> **CI/CD active:** Pushes to `main` in `MedavidaInc/medavida-backend` deploy automatically (test → build → migrate → deploy). Manual steps below are for hotfixes or first-time setup only.

```bash
# 1. Authenticate to ECR
aws sso login --sso-session medavida
aws ecr get-login-password --region us-east-2 --profile medavida | \
  docker login --username AWS --password-stdin \
  049815585091.dkr.ecr.us-east-2.amazonaws.com

# 2. Build and push
docker build -t 049815585091.dkr.ecr.us-east-2.amazonaws.com/medavida-django:latest .
docker push 049815585091.dkr.ecr.us-east-2.amazonaws.com/medavida-django:latest

# 3. Run migrations
AWS_PROFILE=medavida aws ecs run-task \
  --cluster medavida \
  --task-definition medavida-web \
  --launch-type FARGATE \
  --region us-east-2 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0e500332a390401c5],securityGroups=[sg-0af055f287c2f4bed],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"web","command":["python","manage.py","migrate","--noinput"]}]}'

# 4. Force redeploy
AWS_PROFILE=medavida aws ecs update-service --cluster medavida --service medavida-web --force-new-deployment --region us-east-2
AWS_PROFILE=medavida aws ecs update-service --cluster medavida --service medavida-worker --force-new-deployment --region us-east-2
```

---

## Deploying the React Frontend

> **CI/CD active:** Pushes to `main` in `MedavidaInc/Medavidapracticedashboard` deploy automatically (build → S3 sync → CloudFront invalidation). Manual script below is for local deploys or hotfixes.

Use the deploy script from the frontend repo:

```bash
cd /path/to/Medavidapracticedashboard
./scripts/deploy_staging.sh
```

The script: `npm run build` (reads `.env.production`) → S3 sync → CloudFront invalidation + wait.

Key vars baked in at build time:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://api.staging.demoatable.com` |
| `VITE_MEDPLUM_BASE_URL` | `https://medplum.staging.demoatable.com/` |
| `VITE_MEDPLUM_CLIENT_ID` | `d097cfaf-f137-4ae2-8c3c-ba815150687f` |

> `VITE_MEDPLUM_CLIENT_ID` is required. Without it, `MedplumClient.startLogin()` fails with "Failed to fetch".

---

## Deploying Medplum Bots

Bots are deployed automatically by CI when `packages/medavida-bots/src/**` changes.  
See `.github/workflows/deploy-medavida-bots.yml`.

To deploy manually:

```bash
# Build
cd packages/medavida-bots
npm run build

# Get a Medplum access token
TOKEN=$(curl -sf -X POST https://medplum.staging.demoatable.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Deploy a bot (example: stripe-webhook-bot)
BIN_ID=$(curl -sf -X POST https://medplum.staging.demoatable.com/fhir/R4/Binary \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/javascript" \
  --data-binary "@dist/bots/stripe-webhook-bot.js" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -sf -X PUT "https://medplum.staging.demoatable.com/fhir/R4/Bot/3f531da1-2312-4b7d-88a9-aee9956eb652" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"resourceType\":\"Bot\",\"id\":\"3f531da1-2312-4b7d-88a9-aee9956eb652\",\"name\":\"stripe-webhook-bot\",\"runtimeVersion\":\"vmcontext\",\"executableCode\":{\"contentType\":\"application/javascript\",\"url\":\"Binary/$BIN_ID\"}}"
```

> `medplum bot deploy` CLI does **not** work — the JWT `aud` claim is wrong. Always use the FHIR API Binary pattern above.

---

## Medplum ECS Task Configuration (`medavida-medplum:11`)

| Variable | Value | Notes |
|---|---|---|
| `command` | `["env"]` | Loads config from env vars, not baked-in config file |
| `MEDPLUM_BINARY_STORAGE` | `s3:medavida-staging-binaries` | `s3:bucketname` format — no `://` |
| `MEDPLUM_DATABASE_SSL` | `{"rejectUnauthorized":false}` | Must be a JSON string |
| `MEDPLUM_ALLOWED_ORIGINS` | `https://app.medavida.com/,https://app.staging.demoatable.com` | Comma-separated; missing origins → CORS error on login |

---

## Medplum Admin

URL: `https://medplum.staging.demoatable.com/` (no Google OAuth — direct password login)

| Account | Email | Password |
|---|---|---|
| Super admin | `admin@example.com` | `medplum_admin` |
| Demo practitioner | `demo@medavida.com` | `MedaVida2026!` |

**Projects:**
- `161452d9` — FHIR R4 (default)
- `d75b420c` — MedaVida (bots, ClientApplications, patient data)

**ClientApplications (MedaVida project):**
- `31b94039` — Django backend (`client_credentials` grant)
- `d097cfaf` — React SPA (`authorization_code` grant, redirect: `https://app.staging.demoatable.com/`)

**Creating a ClientApplication correctly:** Use `POST /admin/projects/<projectId>/client` — not `POST /fhir/R4/ClientApplication`. The admin endpoint atomically creates the `ClientApplication` + `ProjectMembership`. Without a membership, `client_credentials` returns "Invalid client".

---

## Seeding Demo Data

```bash
# From medavida-backend repo
./scripts/seed_staging.sh
```

Idempotent. Seeds Django (practice, provider, 5 patients, invoices, care plans) and creates `demo@medavida.com` as a Practitioner in Medplum.

---

## Terraform

Infrastructure is defined in `medavida-backend/terraform/`. All commands require `AWS_PROFILE=medavida`.

```bash
cd terraform
AWS_PROFILE=medavida terraform plan
AWS_PROFILE=medavida terraform apply
```

State backend: S3 bucket `medavida-terraform-state`, key `staging/terraform.tfstate`, DynamoDB lock table `medavida-terraform-locks`.

---

## Known Quirks

- **ECR repo name** — Django image is `medavida-django` (not `medavida`)
- **`MEDPLUM_BINARY_STORAGE` format** — `s3:bucketname`, not `s3://bucketname`
- **`MEDPLUM_DATABASE_SSL`** — must be a JSON string; sub-key env vars don't work
- **`MEDPLUM_ALLOWED_ORIGINS`** — must include every browser origin; caused CORS "Failed to fetch" on login (fixed 2026-05-11 in rev 11)
- **Stripe webhook signing** — `stripe==15.0.1` uses raw UTF-8 bytes of the full `whsec_...` string, does not base64-decode
- **`migrate_with_views`** — referenced in task def but not implemented; always use `--overrides` with `python manage.py migrate --noinput`