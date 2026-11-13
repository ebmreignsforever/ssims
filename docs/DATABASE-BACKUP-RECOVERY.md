# Database Backup and Recovery Procedures

## 1. Objectives

| Metric | Academic deployment target | Production recommendation |
|---|---|---|
| RPO (maximum data loss) | 24 hours | 5–15 minutes using WAL archiving |
| RTO (time to restore) | 2 hours | 30–60 minutes with automated failover |
| Retention | 14 daily, 8 weekly | Policy-driven, encrypted, immutable |
| Restore testing | Monthly | Quarterly full drill + monthly PITR test |

The academic project implements logical backups. Production should add continuous archiving/point-in-time recovery on a managed PostgreSQL service.

---

## 2. What is backed up

PostgreSQL contains:

- users and password history;
- sessions (ephemeral, but included for consistency);
- departments, courses, enrollments and grades;
- security policies and IP rules;
- security events, login attempts, audit logs, webhook events and laboratory evidence.

Certificates and `.env` secrets are separate:

- back up the local CA **only** in a secure offline location if you need to retain trust;
- never include `.env` in a database dump;
- production secrets belong in a vault, not backups;
- webhook signing secret and JWT/MFA keys are required to interpret some data (MFA secrets are encrypted with `MFA_ENCRYPTION_KEY`). Losing that key makes existing TOTP secrets unrecoverable.

---

## 3. Automated backup script

`scripts/backup-db.sh`:

```bash
./scripts/backup-db.sh
```

How it works:

1. `pg_dump -Fc` runs inside the `db` container over the trusted local socket.
2. The custom-format dump is written to a temporary container path.
3. `docker compose cp` copies it to `./backups/`.
4. The temporary file is removed.
5. Optional GPG encryption with `BACKUP_GPG_RECIPIENT`.
6. File permissions are set to `600`.

Using `docker compose cp` avoids piping binary data through PowerShell, which can corrupt archives.

Optional encryption:

```bash
BACKUP_GPG_RECIPIENT=security@example.com ./scripts/backup-db.sh
```

For symmetric encryption, add an offline passphrase workflow with `gpg --symmetric`; never store the passphrase with the backup.

---

## 4. Schedule

Example cron for a Linux host:

```cron
15 2 * * * cd /opt/ssims && ./scripts/backup-db.sh >> /var/log/ssims-backup.log 2>&1
```

Retention example:

```bash
find /opt/ssims/backups -type f -name 'ssims-*.dump*' -mtime +30 -delete
```

Do not delete backups on the only host that holds the database. Replicate encrypted archives to an object store with immutability/object lock and a separate credential.

---

## 5. Restore procedure

`scripts/restore-db.sh <archive>`:

1. Optionally decrypts a `.gpg` archive.
2. Stops `nginx`, `backend` and `frontend` to prevent writes and inconsistent reads.
3. Copies the dump into the database container.
4. Runs `pg_restore --clean --if-exists --no-owner --role=ssims_owner`.
5. Removes the temporary file.
6. Restarts the application services.

```bash
docker compose stop nginx backend frontend
./scripts/restore-db.sh backups/ssims-20261111T020000Z.dump
docker compose ps
curl -k https://localhost/health
```

Verify:

- `/health` reports database connected;
- an administrator and a student can sign in;
- dashboards show courses and grades;
- `security_test_runs` and `security_events` are present;
- database audit rows are present;
- no app role errors in backend logs.

### Manual restore into a scratch database

For validation without touching production:

```bash
docker compose exec -T db createdb -U postgres ssims_restore_test
docker compose cp backup.dump db:/tmp/restore.dump
docker compose exec -T db pg_restore -U postgres -d ssims_restore_test --no-owner /tmp/restore.dump
```

Inspect counts, then drop the scratch database.

---

## 6. Point-in-time recovery (production)

For an RPO measured in minutes:

1. Set `archive_mode=on`, `archive_command` to copy WAL to encrypted object storage.
2. Take a base backup (`pg_basebackup`) regularly.
3. Retain WAL long enough for the recovery window.
4. Restore the base backup and replay WAL to the desired timestamp.
5. Test PITR on a non-production instance quarterly.
6. Automate verification of archive continuity.

Managed PostgreSQL services usually provide this without manual WAL scripts. Prefer them for production.

---

## 7. Backup security

- Encrypt backups at rest and in transit.
- Use a dedicated backup credential with read-only/backup privileges; do not use the API role.
- Store backups in a separate failure domain.
- Enable object lock/immutability to resist ransomware deletion.
- Restrict restore access to a break-glass administrator group.
- Audit restore operations separately.
- Never log database passwords or encryption passphrases.
- Store `MFA_ENCRYPTION_KEY` in a key vault with a documented recovery process; a database restore without it cannot decrypt MFA secrets.

---

## 8. Disaster recovery scenarios

### Scenario A — application container destroyed

`docker compose up -d` recreates it. Database is on a named volume. No restore needed.

### Scenario B — database volume corrupted

1. Stop application services.
2. Create a new `pg_data` volume.
3. Start `db`.
4. Let migrations run if a fresh schema is needed.
5. Restore the latest backup.
6. Re-apply grants if the backup did not include them (the schema migration includes grants; test your backup scope).
7. Restart and verify.

### Scenario C — accidental grade/user modification

Because security logs are append-only and database audit triggers capture old/new values, identify the affected rows and correct them through the API (which creates another audit event). If bulk corruption occurred, restore to a scratch database, extract affected rows, and apply a controlled correction with approval.

### Scenario D — lost encryption key

- MFA secrets cannot be decrypted; users must re-enroll MFA.
- Reset affected MFA records through a documented administrative procedure.
- All other password hashes are not encrypted with the MFA key.
- Rotate affected sessions/secrets as a precaution.

---

## 9. Restore drill checklist

- [ ] Backup archive exists and is non-zero.
- [ ] Encryption key/recipient available to authorized staff.
- [ ] Restore into scratch database succeeds.
- [ ] Row counts match expected ranges.
- [ ] Login works with a known account.
- [ ] RBAC: student cannot access admin endpoint.
- [ ] Audit and security events are present.
- [ ] Health endpoint is green.
- [ ] Time to restore recorded.
- [ ] Findings and corrective actions documented.

---

## 10. Limitations

- The academic deployment does not configure WAL archiving.
- Backups are logical, not physical; very large databases would need physical backups/PITR.
- The scripts assume Docker Compose.
- No off-site replication is provisioned by the project; the operator must configure it.
- The local CA is not part of database backups and is intentionally isolated.
