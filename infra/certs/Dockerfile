FROM alpine:3.20

RUN apk add --no-cache openssl bash
COPY infra/certs/generate-certs.sh /usr/local/bin/generate-certs.sh
RUN chmod +x /usr/local/bin/generate-certs.sh

ENTRYPOINT ["/usr/local/bin/generate-certs.sh"]
