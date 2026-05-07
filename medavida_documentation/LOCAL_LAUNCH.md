# MedaVida — Local Launch Instructions

> Last updated: 2026-05-06  
> Node: v22.17.0 | npm: 10.9.2

There are two ways to run the stack locally depending on what you're working on.

---

## Option A — Simple (recommended for frontend + bot development)

Runs Postgres and Redis in Docker, the Medplum server directly with Node, and the custom app with Vite. No Kubernetes required.

### Prerequisites

- [Docker Desktop](https://docs.docker.com/desktop/) running
- Node v22+ (`node --version`)
- npm 10+ (`npm --version`)

### 1. Start the backing services

```sh
# From the repo root
docker-compose up -d
```

This starts:
- PostgreSQL on `localhost:5432` (user: `medplum`, pass: `medplum`)
- Redis on `localhost:6379` (pass: `medplum`)

### 2. Start the Medplum server

```sh
cd packages/server
npm install
npm run dev
```

Server runs on **http://localhost:8103**  
Health check: http://localhost:8103/healthcheck  
FHIR API: http://localhost:8103/fhir/R4/metadata

### 3. Start the MedaVida app

In a new terminal:

```sh
cd packages/medavida-app
npm install
npm run dev
```

App runs on **http://localhost:3001**

> Default Medplum admin credentials on a fresh local instance:  
> Email: `admin@example.com` | Password: `medplum_admin`  
> Change these immediately after first login.

### 4. Run the bot tests

```sh
cd packages/medavida-bots
npm install
npm test
```

Tests use `@medplum/mock` — no running server required.

### Stopping everything

```sh
# Stop Docker services
docker-compose down

# To also wipe the Postgres volume (full reset)
docker-compose down -v
```

---

## Option B — Full stack with Kubernetes + Fission (bot deployment)

Use this when you need to deploy and test bots in an environment that mirrors production. Requires Docker Desktop with Kubernetes enabled.

### Prerequisites

- [Docker Desktop](https://docs.docker.com/desktop/) with **Kubernetes enabled**
  - Settings → Kubernetes → Enable Kubernetes → Apply & Restart
  - Allocate at least **8 GB RAM** and **4 CPUs**
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm](https://helm.sh/docs/intro/install/)
- [Fission CLI](https://fission.io/docs/installation/)

### Verify prerequisites

```sh
kubectl config current-context   # should be: docker-desktop
kubectl get nodes                 # should show: docker-desktop   Ready
helm version
fission version
```

### Deploy the full stack

```sh
cd examples/medplum-local-k8s
./deploy-local.sh
```

This script handles everything:
1. Creates the `medplum` namespace
2. Installs Fission (serverless bot runtime) via Helm
3. Deploys Postgres + Redis to Kubernetes
4. Deploys the Medplum server via our Helm chart
5. Deploys the Medplum web app
6. Creates the Fission Node.js environment for bots

### Access points after deployment

| Service | URL |
|---|---|
| Medplum App (upstream UI) | http://localhost:3000 |
| Medplum Server | http://localhost:8103 |
| FHIR API | http://localhost:8103/fhir/R4/metadata |

### Start the MedaVida app (separate step)

```sh
cd packages/medavida-app
npm install
npm run dev   # runs on http://localhost:3001
```

### Build and deploy a bot

```sh
# Build all bots
cd packages/medavida-bots
npm run build   # outputs to dist/

# Deploy a specific bot via Medplum CLI
npx medplum bot deploy dpc-payment-bot
```

### Tear down

```sh
cd examples/medplum-local-k8s
./cleanup-local.sh
```

---

## Useful commands

```sh
# Check Medplum server health
curl http://localhost:8103/healthcheck

# Tail Medplum server logs (Option A)
cd packages/server && npm run dev

# Tail Medplum server logs (Option B — Kubernetes)
kubectl logs -n medplum deployment/medplum -f

# Check all pods (Option B)
kubectl get pods -n medplum

# Check Fission environments
fission env list

# Reset Postgres (Option A — full wipe)
docker-compose down -v && docker-compose up -d
```

---

## Troubleshooting

**`docker-compose up` fails — port already in use**  
Another process is on 5432 or 6379. Stop it or change the port mapping in `docker-compose.yml`.

**Medplum server won't connect to Postgres**  
Make sure Docker services are running: `docker-compose ps`. Check the server config at `packages/server/medplum.config.json` — database host should be `localhost`.

**Kubernetes DNS test fails during `deploy-local.sh`**  
This is often a transient warning and the deployment continues. If services can't reach each other, restart Docker Desktop and re-enable Kubernetes.

**Fission Node.js environment creation fails**  
Run manually after the script completes:
```sh
fission environment create --name nodejs \
  --image ghcr.io/fission/node-env \
  --builder ghcr.io/fission/node-builder
```

**Bot tests fail locally**  
Tests use `@medplum/mock` and don't need a running server. If they fail, check that `npm install` completed in `packages/medavida-bots/`.
