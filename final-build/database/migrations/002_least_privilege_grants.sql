-- =============================================================================
-- Least-privilege database roles
--   ssims_owner    : schema owner / migrator (no application login)
--   ssims_app      : runtime API role. DML only, no DDL, no security-log mutation.
--   ssims_readonly : reporting/audit read-only role.
-- The runtime API never connects as the schema owner or a superuser.
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssims_app') THEN
    CREATE ROLE ssims_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssims_readonly') THEN
    CREATE ROLE ssims_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- Remove any accidental broad access.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM ssims_app;
REVOKE CREATE ON SCHEMA public FROM ssims_readonly;
GRANT USAGE ON SCHEMA public TO ssims_app, ssims_readonly;

DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ssims_app, ssims_readonly', current_database());
END $$;

-- Read-only role: SELECT only.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ssims_readonly;

-- Application read access.
GRANT SELECT ON
  departments, users, password_history, sessions, mfa_backup_codes,
  password_reset_tokens, auth_challenges, login_attempts, security_events,
  ip_rules, courses, enrollments, grades, security_policies, webhook_events,
  security_test_runs, audit_log
TO ssims_app;

-- Application write access. Deliberately no DELETE on users or audit tables.
GRANT INSERT ON users TO ssims_app;
GRANT UPDATE (
  email, password_hash, full_name, role, status, student_id, staff_id,
  department_id, phone, address, programme, level, mfa_enabled,
  mfa_secret_enc, mfa_pending_secret_enc, mfa_last_totp_step, must_change_password,
  failed_login_count, locked_until, last_login_at, last_login_ip,
  last_password_change_at, updated_at
) ON users TO ssims_app;

GRANT SELECT, INSERT ON password_history TO ssims_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO ssims_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_backup_codes TO ssims_app;
GRANT SELECT, INSERT, UPDATE ON password_reset_tokens TO ssims_app;
GRANT SELECT, INSERT, UPDATE ON auth_challenges TO ssims_app;
GRANT SELECT, INSERT ON login_attempts TO ssims_app;
GRANT SELECT, INSERT ON security_events TO ssims_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ip_rules TO ssims_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO ssims_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON courses TO ssims_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON enrollments TO ssims_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON grades TO ssims_app;

GRANT SELECT, UPDATE ON security_policies TO ssims_app;
GRANT SELECT, INSERT ON webhook_events TO ssims_app;
GRANT SELECT, INSERT ON security_test_runs TO ssims_app;
GRANT SELECT ON audit_log TO ssims_app;

GRANT USAGE, SELECT ON SEQUENCE
  password_history_id_seq,
  login_attempts_id_seq,
  security_events_id_seq,
  webhook_events_id_seq
TO ssims_app;

-- Explicitly revoke mutation of immutable security records (defence in depth).
REVOKE UPDATE, DELETE, TRUNCATE ON
  security_events, login_attempts, webhook_events, security_test_runs, audit_log
FROM ssims_app, ssims_readonly;

-- Future tables created by the owner default to read-only for the reporting role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ssims_readonly;
