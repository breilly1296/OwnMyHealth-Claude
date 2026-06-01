# OwnMyHealth Backend Dockerfile
# Production-ready Node.js container for AWS ECS deployment

FROM node:20-alpine AS builder

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

# Production stage
FROM node:20-alpine AS production

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

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app.js"]
