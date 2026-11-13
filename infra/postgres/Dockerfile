FROM postgres:16-alpine

# TLS-only host access and a local socket for container-internal administration.
COPY infra/postgres/pg_hba.conf /etc/postgresql/pg_hba.conf
COPY database/init/00-roles.sh /docker-entrypoint-initdb.d/00-roles.sh
RUN chmod +x /docker-entrypoint-initdb.d/00-roles.sh

# The official entrypoint initializes the cluster, then these arguments enforce
# TLS for every TCP connection and start from the custom pg_hba file.
CMD ["postgres", "-c", "ssl=on", "-c", "ssl_cert_file=/var/lib/postgresql/certs/server.crt", "-c", "ssl_key_file=/var/lib/postgresql/certs/server.key", "-c", "ssl_ca_file=/var/lib/postgresql/certs/ca.crt", "-c", "ssl_min_protocol_version=TLSv1.2", "-c", "hba_file=/etc/postgresql/pg_hba.conf", "-c", "password_encryption=scram-sha-256"]
