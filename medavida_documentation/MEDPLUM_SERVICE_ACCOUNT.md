# Medplum Service Account & Admin Guide

> Last updated: 2026-05-27

This document explains how Medplum admin access works, what the Django service account is,
why it needs admin rights, and how to set everything up on a fresh instance.

---

## Background: Medplum Auth Concepts

### ClientApplication (service account)

A `ClientApplication` is a Medplum FHIR resource that represents a non-human caller — in
our case, the Django backend. It authenticates via the OAuth2 `client_credentials` grant
(client ID + secret, no user involved) and receives a bearer token scoped to the project
it belongs to.

The Django backend's `ClientApplication` credentials are stored in two places:
- **Django DB** — `MedplumKeys` table (`client_id`, `client_secret`, cached `access_token`)
- **AWS Secrets Manager** — `medavida/staging/app` as `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET`

### ProjectMembership

Every principal that accesses Medplum — whether a human user or a `ClientApplication` —
must have a `ProjectMembership` resource linking them to the project. Without it, the
`client_credentials` flow returns `"Invalid client"`.

`ProjectMembership` also carries an `admin` flag. When `admin: true`, that principal can
call the Medplum project admin API endpoints (`/admin/projects/{id}/...`).

### Super Admin vs Project Admin

| Level | How set | What it grants |
|---|---|---|
| **Super admin** | `User.admin = true` in DB | System-wide access across all projects |
| **Project admin** | `ProjectMembership.admin = true` | Admin API access within one project |

The Django service account needs **project admin** (`ProjectMembership.admin = true`) to
call `POST /admin/projects/{id}/invite` when provisioning new Medplum user accounts.

### Why there is no Medplum web console

MedaVida runs a self-hosted Medplum instance. We do not have access to the Medplum cloud
console at `app.medplum.com`. All admin operations must go through the Medplum REST API
or the Django management commands documented below.

---

## Staging Instance

| Item | Value |
|---|---|
| Medplum URL | `https://medplum.staging.medavida.app/` |
| Project ID | `835efbfd-da6b-484b-9da1-26c18a3e306a` |
| Django backend `ClientApplication` | `6e5f62ba-5380-4e62-87a8-dfa977210955` |
| React SPA `ClientApplication` | `cbeaa6ae-bca6-4869-9c74-28f882d1a8bf` |

### User accounts

| Email | Password | Notes |
|---|---|---|
| `admin@example.com` | `medplum_admin` | Created on first boot. Has no super-admin flag and no ProjectMembership until `bootstrap_medplum` is run. |
| `demo@medavida.com` | `MedaVida2026!` | Practitioner account. No admin rights. |

---

## The Problem with Fresh Instances

When Medplum starts for the first time it creates `admin@example.com` as a bare `User`
record. Critically:

1. **No `ProjectMembership`** — the account cannot log in to any project-scoped API.
2. **No `User.admin = true`** — it is not a system super-admin.
3. **`MEDPLUM_ADMIN_EMAIL` / `MEDPLUM_ADMIN_PASSWORD`** are not set in Secrets Manager —
   `seed_staging.sh` falls back to the default credentials above.

This means on a fresh instance there is no account that can call the Medplum admin API,
creating a bootstrapping problem: you need admin rights to create admin rights.

The solution is the `bootstrap_medplum` management command, which breaks the loop by
going directly to the PostgreSQL database.

---

## Management Commands

All commands live in `medavida-backend/core/management/commands/`. Run them via
`python manage.py <command>` inside the Django container, or as a one-off ECS Fargate task
(see the ECS task pattern below).

### `bootstrap_medplum` — fresh instance setup

**Use when:** standing up a new Medplum instance from scratch.

Runs three phases in sequence:

1. **DB phase** — connects directly to the Medplum PostgreSQL database, sets
   `User.admin = true` on the admin account, and creates (or patches) a `ProjectMembership`
   with `admin: true` so the account can authenticate.
2. **API phase** — authenticates as that admin and calls
   `POST /admin/projects/{id}/client` to create the Django backend `ClientApplication` +
   `ProjectMembership` atomically.
3. **Store phase** — saves the new `client_id` and `client_secret` to the `MedplumKeys`
   Django DB table.

```bash
python manage.py bootstrap_medplum \
  --db-host <rds-host> \
  --db-name <dbname> \
  --db-user <user> \
  --db-password <password> \
  --admin-email admin@example.com \
  --admin-password medplum_admin

# Re-bootstrap (replaces existing ClientApplication):
python manage.py bootstrap_medplum ... --force
```

After running, copy the printed `client_id` and `client_secret` into Secrets Manager
(`medavida/staging/app`) as `MEDPLUM_CLIENT_ID` and `MEDPLUM_CLIENT_SECRET`, then redeploy
the ECS services so they pick up the new credentials.

---

### `setup_medplum_service_account` — recreate service account only

**Use when:** the `ClientApplication` needs to be replaced (e.g. secret rotation) but the
admin account is already working.

Authenticates as a project admin and calls `POST /admin/projects/{id}/client`. Updates
`MedplumKeys` with the new credentials.

```bash
python manage.py setup_medplum_service_account \
  --email admin@example.com --password medplum_admin

# Replace existing:
python manage.py setup_medplum_service_account \
  --email admin@example.com --password medplum_admin --force
```

---

### `grant_medplum_service_admin` — grant admin to existing service account

**Use when:** the `ClientApplication` already exists but its `ProjectMembership.admin` is
`false`, causing 403s on the invite endpoint.

Authenticates as a project admin, finds the `ClientApplication`'s `ProjectMembership` via
`GET /admin/projects/{id}/members`, and updates it with `admin: true`.

```bash
python manage.py grant_medplum_service_admin \
  --email admin@example.com --password medplum_admin
```

---

### `patch_medplum_membership_admin` — DB-level admin grant

**Use when:** no working admin account is available (the nuclear option). Connects directly
to PostgreSQL and sets `admin: true` on the service account's `ProjectMembership`.

```bash
python manage.py patch_medplum_membership_admin \
  --host <rds-host> --dbname <dbname> \
  --user <user> --password <password> \
  --client-id 6e5f62ba-5380-4e62-87a8-dfa977210955
```

---

### `inspect_medplum_db` — diagnostic

Lists all Medplum user accounts and the service account's project memberships.
Useful for verifying state after running any of the above commands.

```bash
python manage.py inspect_medplum_db \
  --host <rds-host> --dbname <dbname> \
  --user <user> --password <password>
```

---

### `update_medplum_keys` — update stored credentials

Updates (or creates) the `MedplumKeys` record when you already have a `client_id` and
`client_secret` (e.g. from Secrets Manager or after manual creation).

```bash
python manage.py update_medplum_keys \
  --client-id <id> --client-secret <secret>
```

---

## Running Commands Against Staging (ECS one-off task)

The RDS instance is in a private subnet — commands that need DB access must run inside the
VPC. Use the ECS run-task pattern:

```bash
aws ecs run-task \
  --cluster medavida \
  --task-definition medavida-web \
  --launch-type FARGATE \
  --region us-east-2 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0e500332a390401c5],securityGroups=[sg-0af055f287c2f4bed],assignPublicIp=DISABLED}" \
  --overrides '{
    "containerOverrides":[{"name":"web","command":[
      "python","manage.py","<command>",
      "<arg1>","<value1>", ...
    ]}]
  }'
```

Wait for completion and fetch logs:

```bash
# Wait
aws ecs wait tasks-stopped --cluster medavida --tasks <TASK_ARN> --region us-east-2

# Exit code
aws ecs describe-tasks --cluster medavida --tasks <TASK_ARN> --region us-east-2 \
  --query 'tasks[0].containers[?name==`web`].exitCode' --output text

# Logs  (TASK_ID = last segment of TASK_ARN)
aws logs get-log-events \
  --log-group-name /ecs/medavida-django/web \
  --log-stream-name "web/web/<TASK_ID>" \
  --region us-east-2 \
  --query 'events[*].message' --output text
```

> **Mac builds:** always pass `--platform linux/amd64` to `docker build` before pushing.
> Without it the image is ARM64 and ECS will refuse to pull it.

---

## Decision Tree

```
Fresh Medplum instance?
  └─ Yes → run bootstrap_medplum

Service account exists but gets 403 on /admin/...?
  ├─ Admin account works → run grant_medplum_service_admin
  └─ No working admin account → run patch_medplum_membership_admin (DB direct)

Need to rotate service account secret?
  └─ run setup_medplum_service_account --force

Not sure what state things are in?
  └─ run inspect_medplum_db
```

---

## Secrets Manager Keys (medavida/staging/app)

| Key | Description |
|---|---|
| `MEDPLUM_CLIENT_ID` | Django backend `ClientApplication` ID |
| `MEDPLUM_CLIENT_SECRET` | Django backend `ClientApplication` secret |
| `MEDPLUM_ADMIN_EMAIL` | Admin user email used by `seed_staging.sh` (not currently set — falls back to `admin@example.com`) |
| `MEDPLUM_ADMIN_PASSWORD` | Admin user password used by `seed_staging.sh` (not currently set — falls back to `medplum_admin`) |

> Setting `MEDPLUM_ADMIN_EMAIL` and `MEDPLUM_ADMIN_PASSWORD` in Secrets Manager is
> recommended so the seed script doesn't rely on hardcoded defaults.
