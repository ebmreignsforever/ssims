FROM nginxinc/nginx-unprivileged:1.27-alpine

USER root
RUN apk add --no-cache curl
COPY default.conf /etc/nginx/conf.d/default.conf
COPY proxy_params_ssims.conf /etc/nginx/proxy_params_ssims.conf
RUN chown -R 101:101 /etc/nginx/conf.d
USER 101

EXPOSE 8080 8443
HEALTHCHECK --interval=20s --timeout=6s --start-period=15s --retries=5 \
  CMD curl -fsSk https://127.0.0.1:8443/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
