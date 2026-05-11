# MedaVida — Local Launch Instructions

> Last updated: 2026-05-11  
> Node: v20+ | npm: 10+

---

## Option A — Bot Development (recommended)

Run bot tests only — no server required. Uses `@medplum/mock`.

```sh
cd packages/medavida-bots
npm install
npm test          # vitest with @medplum/mock
npm run build     # esbuild → dist/bots/
```

This is the fastest path for iterating on bot logic.

---

## Option B — Full Stack with Docker (server + bots)

Runs Postgres and Redis in Docker, the Medplum server with Node. Use this when you need to test bots against a real Medplum API locally.

### Prerequisites

- Docker Desktop running
- Node v20+ (`node --version`)

### 1. Start backing services

```sh
# From the repo root
docker-compose up -d
```

Starts:
- PostgreSQL on `localhost:5432` (user: `medplum`, pass: `medplum`)
- Redis on `localhost:6379`

### 2. Start the Medplum server

```sh
cd packages/server
npm install
npm run dev
```

Server: `http://localhost:8103`  
Health check: `http://localhost:8103/healthcheck`  
Default admin: `admin@example.com` / `medplum_admin`

### 3. Build and upload bots (optional)

```sh
cd packages/medavida-bots
npm install
npm run build

# Get a local token, then upload each bot Binary and update Bot.executableCode.url
# See AWS_DEPLOYMENT.md — "Deploying Medplum Bots" for the exact curl commands
# (use http://localhost:8103 as the base URL)
```

> The Medplum CLI `medplum bot deploy` does **not** work against self-hosted servers — always use the FHIR API Binary pattern.

### Stop everything

```sh
docker-compose down
docker-compose down -v   # also wipes Postgres volume
```

---

## Option C — Against Staging Directly

For frontend development, just point your React app at staging:

```sh
cd /path/to/Medavidapracticedashboard

# .env.local
VITE_API_URL=https://api.staging.demoatable.com
VITE_MEDPLUM_BASE_URL=https://medplum.staging.demoatable.com/
VITE_MEDPLUM_CLIENT_ID=d097cfaf-f137-4ae2-8c3c-ba815150687f

npm run dev   # localhost:5173
```

Login with `demo@medavida.com` / `MedaVida2026!`.

The dev mode login bypass also works: any email containing "demo" auto-authenticates against staging without requiring valid credentials.

---

## Useful Commands

```sh
# Check Medplum server health (local)
curl http://localhost:8103/healthcheck

# Check Medplum server health (staging)
curl https://medplum.staging.demoatable.com/healthcheck

# Run bot tests with coverage
cd packages/medavida-bots
npm run test:coverage

# Lint bots
npm run lint

# Build and inspect output
npm run build
ls dist/bots/
```

---

## Troubleshooting

**`docker-compose up` fails — port in use**  
Stop any local Postgres (`brew services stop postgresql`) or Redis instance, or change the port mapping in `docker-compose.yml`.

**Medplum server won't connect to Postgres**  
Check `docker-compose ps`. The server config is at `packages/server/medplum.config.json` — database host should be `localhost`.

**Bot tests fail**  
Tests use `@medplum/mock` and don't need a running server. If they fail, run `npm install` in `packages/medavida-bots/` and try again.

**"Failed to fetch" on local React app login**  
Check that `VITE_MEDPLUM_CLIENT_ID` is set in `.env.local`. The `MedplumClient` requires a `clientId` to call `startLogin`.

**CORS error on `POST /auth/login`**  
The Medplum server's `MEDPLUM_ALLOWED_ORIGINS` env var must include your local origin (`http://localhost:5173`). For local dev against the staging Medplum server this is a known gap — use the demo bypass or Option C.