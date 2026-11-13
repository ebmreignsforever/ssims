# syntax=docker/dockerfile:1.7
# =============================================================================
# SSIMS single-container PaaS image
#
# For free Docker hosting (Render/Koyeb) where only one public service and one
# port are available. The Express API also serves the compiled React SPA.
# Database is an external managed PostgreSQL instance over TLS.
#
# Local Compose still uses the segmented Nginx/API/PostgreSQL architecture.
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
RUN pnpm install --frozen-lockfile --ignore-scripts --node-linker=hoisted

COPY backend ./backend
COPY frontend ./frontend
COPY database ./database
RUN pnpm --filter @ssims/backend build \
    && pnpm --filter @ssims/frontend build

# ---------------------------------------------------------------------------
# Runtime
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
COPY --from=build --chown=ssims:ssims /app/frontend/dist /app/public
COPY --chown=ssims:ssims deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /app/certs/public \
    && chown -R ssims:ssims /app

USER ssims
WORKDIR /app/backend

ENV NODE_ENV=production
ENV SERVE_FRONTEND=true
ENV FRONTEND_DIST=/app/public
ENV MIGRATIONS_DIR=/app/database/migrations
ENV PORT=10000
EXPOSE 10000

HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=8 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
