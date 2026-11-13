# syntax=docker/dockerfile:1.7
# =============================================================================
# SSIMS React frontend — build with Vite, serve static assets from a hardened
# unprivileged Nginx container. The edge reverse proxy is a separate service.
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
RUN pnpm install --frozen-lockfile --ignore-scripts --node-linker=hoisted --filter @ssims/frontend...

COPY frontend ./frontend
RUN pnpm --filter @ssims/frontend build

FROM nginxinc/nginx-unprivileged:1.27-alpine

USER root
COPY infra/nginx/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
RUN chown -R 101:101 /usr/share/nginx/html /etc/nginx/conf.d
USER 101

EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
