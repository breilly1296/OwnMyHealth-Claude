# OwnMyHealth Backend Dockerfile
# Production-ready Node.js container for GCP Cloud Run deployment

# Base image digest-pinned so a rebuild is reproducible and tamper-evident: the
# `22-alpine` tag is mutable (Docker Hub re-points it on every patch release),
# so an unpinned FROM means two builds of the same commit can pull different
# bytes. The trailing `# node:22-alpine` comment names the tag this digest
# resolved to. Digest is the multi-arch index (linux/amd64 for Cloud Run),
# resolved 2026-06-14 from Docker Hub registry-1.docker.io/library/node.
# Bump it deliberately (e.g. via Renovate) when adopting a newer patch.
# M15: bumped from node:20-alpine (Node 20 reached end-of-life Apr 2026) to
# node:22-alpine (Maintenance LTS). Prisma 7 requires Node ^22.12; 22-alpine
# tracks the latest 22.x so it satisfies that. No native runtime modules
# (Prisma 7 = WASM query compiler + pure-JS pg; bcryptjs is pure-JS).
FROM node:22-alpine@sha256:9385cd9f3001dfc3431e8ead12c43e9e1f87cc1b9b5c6cfd0f73865d405b27c4 AS builder
# node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci

COPY src ./src/
COPY tsconfig.json ./

# Provide dummy DATABASE_URL for prisma generate (only generates client, doesn't connect)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

RUN npm run build

# Production stage — same digest-pinned base as the builder above (kept in sync;
# bump both together).
FROM node:22-alpine@sha256:9385cd9f3001dfc3431e8ead12c43e9e1f87cc1b9b5c6cfd0f73865d405b27c4 AS production
# node:22-alpine

WORKDIR /app

# RT-H1: pin the security tier to production at the image level. Without this,
# a deploy that forgets to set NODE_ENV boots at the dev tier (lax cookies,
# BAA gate as warning, etc. — see config/index.ts). The Cloud Run deploy step
# also sets NODE_ENV=production via --update-env-vars; this ENV is the backstop
# for any run of the image (local `docker run`, other orchestrators) that
# omits it.
#
# OMH_DEPLOY_ENFORCE_PROD marks "this is a deployed image" — config/index.ts
# hard-fails at boot if this flag is set but NODE_ENV resolves to the dev
# fallback (e.g. an orchestrator clobbered NODE_ENV). Local `npm run dev`
# never sets it, so dev is unaffected.
ENV NODE_ENV=production
ENV OMH_DEPLOY_ENFORCE_PROD=true

RUN apk update && apk upgrade && rm -rf /var/cache/apk/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma/
COPY prisma.config.ts ./

# Provide dummy DATABASE_URL for prisma generate
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated

# M-16: strip source maps from the production image. Shipped .map files let
# anyone with the bundle reconstruct original TypeScript (internal paths,
# comments, control-flow) — needless attack-surface disclosure for a HIPAA
# backend. tsconfig.json still emits maps for local dev; we delete them here
# rather than maintain a separate prod tsconfig.
RUN find ./dist -name '*.map' -type f -delete

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:${PORT:-3001}/health || exit 1

# Migrations do NOT run at boot. `prisma migrate deploy` runs as a Cloud Run
# job in the deploy pipeline (.github/workflows/deploy.yml, "Run database
# migrations") — teardown finding #18: the old `migrate && node` CMD made
# every cold start pay the ~10s migrate check, and a failing migration
# bricked container boot instead of failing the deploy. Local `docker run`s
# must apply migrations separately, e.g.:
#   docker run --rm -e DATABASE_URL=... <image> npx prisma migrate deploy
CMD ["node", "dist/app.js"]
