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

RUN apk update && apk upgrade && rm -rf /var/cache/apk/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma/
COPY prisma.config.ts ./

# Provide dummy DATABASE_URL for prisma generate
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated 2>/dev/null || true

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:${PORT:-3001}/health || exit 1

CMD ["node", "dist/app.js"]
