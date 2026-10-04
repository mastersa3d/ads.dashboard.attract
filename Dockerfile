# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage image for the Marketing Intelligence Dashboard.
#
#   docker build --target app    -t mimd-app .     # Next.js standalone server (small)
#   docker build --target worker -t mimd-worker .  # job worker + prisma CLI (migrations, seed)
#
# The `worker` target carries the full node_modules (tsx, prisma CLI) and is also used by
# the one-shot `migrate` service in docker-compose.yml (`npx prisma migrate deploy`).
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22

# ── base ─────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
# No extra OS packages: Alpine already ships libssl3/libcrypto3 (used by the Prisma engine) and
# busybox wget (health check). Signal handling for PID 1 comes from `init: true` in compose
# (or `docker run --init`), so the image builds even where package mirrors are unreachable.
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── deps: full dependency tree (dev deps needed for build, tsx and prisma CLI) ─
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ── builder: prisma generate + next build (output: "standalone") ─────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only; real values are injected at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NODE_ENV=production
# public/ may be absent in a fresh clone (git does not track empty dirs)
RUN mkdir -p public && npx prisma generate && npx next build

# ── app: minimal runtime ─────────────────────────────────────────────────────
FROM base AS app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/app/uploads
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs \
 && mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Prisma schema + migrations and the generated client/engine (standalone tracing can miss the engine).
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
VOLUME ["/app/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -Y off -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "server.js"]

# ── worker: background jobs, migrations, seed ────────────────────────────────
FROM base AS worker
ENV NODE_ENV=production \
    UPLOAD_DIR=/app/uploads
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs \
 && mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=nextjs:nodejs package.json package-lock.json tsconfig.json ./
COPY --chown=nextjs:nodejs prisma ./prisma
COPY --chown=nextjs:nodejs src ./src
COPY --chown=nextjs:nodejs worker ./worker
COPY --chown=nextjs:nodejs scripts ./scripts
USER nextjs
CMD ["node", "node_modules/tsx/dist/cli.mjs", "worker/index.ts"]
