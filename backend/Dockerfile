# syntax=docker/dockerfile:1.7
# =============================================================================
# SSIMS API — multi-stage production image
# Build context is the repository root so the lockfile and database migrations
# can be included without copying secrets (.dockerignore excludes .env).
# =============================================================================
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.28.5 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --node-linker=hoisted --filter @ssims/backend...

COPY backend ./backend
COPY database ./database
RUN pnpm --filter @ssims/backend build

# ---------------------------------------------------------------------------
# Production runtime: reinstall only runtime dependencies, copy compiled code.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.28.5 --activate \
    && groupadd --system --gid 1001 ssims \
    && useradd --system --uid 1001 --gid ssims --create-home ssims

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts --node-linker=hoisted --filter @ssims/backend... \
    && pnpm store prune \
    && rm -rf /app/frontend

COPY --from=build --chown=ssims:ssims /app/backend/dist /app/backend/dist
COPY --from=build --chown=ssims:ssims /app/backend/package.json /app/backend/package.json
COPY --from=build --chown=ssims:ssims /app/database /app/database

RUN mkdir -p /app/certs/public && chown -R ssims:ssims /app
USER ssims
WORKDIR /app/backend

ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/app/database/migrations
EXPOSE 4000

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
