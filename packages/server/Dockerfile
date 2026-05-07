# Expects dist/ to be pre-built locally. Run `npm run build` before docker build.

FROM node:22-alpine AS builder
ENV NODE_ENV=production
WORKDIR /usr/src/medplum

# Copy root manifests
COPY package.json package-lock.json ./

# Copy ALL workspace package manifests so npm can resolve hoisted deps correctly
COPY packages/ packages/
# Remove source files — keep only package.json files for the npm ci layer
RUN find packages -type f ! -name 'package.json' -delete 2>/dev/null || true

RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache curl
WORKDIR /usr/src/medplum

COPY --from=builder /usr/src/medplum/node_modules ./node_modules
COPY package.json ./

COPY packages/bot-layer/package.json packages/bot-layer/
COPY packages/ccda/dist packages/ccda/dist
COPY packages/ccda/package.json packages/ccda/
COPY packages/core/dist packages/core/dist
COPY packages/core/package.json packages/core/
COPY packages/definitions/dist packages/definitions/dist
COPY packages/definitions/package.json packages/definitions/
COPY packages/fhir-router/dist packages/fhir-router/dist
COPY packages/fhir-router/package.json packages/fhir-router/
COPY packages/server/dist packages/server/dist
COPY packages/server/package.json packages/server/
COPY packages/server/medplum.config.production.json medplum.config.json

EXPOSE 8103

ENTRYPOINT ["node", "packages/server/dist/index.js"]
