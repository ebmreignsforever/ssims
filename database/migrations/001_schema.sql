-- =============================================================================
-- SSIMS core schema
-- PostgreSQL 16+
-- All identifiers are quoted only where necessary; every application query uses
-- bind parameters (never string-concatenated user input).
-- =============================================================================

-- PostgreSQL 16+ provides gen_random_uuid() in core, so no extension is
-- required. Avoiding pgcrypto also keeps migrations compatible with managed
-- PostgreSQL services where the application role cannot create extensions.

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'administrator', 'lecturer', 'student');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM ('active', 'locked', 'suspended', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE severity_level AS ENUM ('info', 'low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,12}$'),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 160),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  role user_role NOT NULL DEFAULT 'student',
  status account_status NOT NULL DEFAULT 'active',
  student_id TEXT UNIQUE,
  staff_id TEXT UNIQUE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  phone TEXT,
  address TEXT,
  programme TEXT,
  level TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_enc TEXT,
  mfa_pending_secret_enc TEXT,
  mfa_last_totp_step BIGINT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip INET,
  last_password_change_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_student_identifier CHECK (role <> 'student' OR student_id IS NOT NULL),
  CONSTRAINT users_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_role_status_idx ON users (role, status);
CREATE INDEX IF NOT EXISTS users_department_idx ON users (department_id);

CREATE TABLE IF NOT EXISTS password_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_history_user_idx ON password_history (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_refresh_hash TEXT NOT NULL UNIQUE,
  previous_refresh_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_ip INET,
  last_ip INET,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_backup_codes_user_idx ON mfa_backup_codes (user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  ip INET,
  prompt TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_challenges_identifier_idx ON auth_challenges (identifier, created_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  ip INET,
  successful BOOLEAN NOT NULL,
  failure_reason TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts (ip, created_at DESC);

CREATE TABLE IF NOT EXISTS security_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  ip INET,
  event_type TEXT NOT NULL,
  severity severity_level NOT NULL DEFAULT 'info',
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS security_events_time_idx ON security_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS security_events_type_idx ON security_events (event_type);
CREATE INDEX IF NOT EXISTS security_events_severity_idx ON security_events (severity);
CREATE INDEX IF NOT EXISTS security_events_ip_idx ON security_events (ip);

CREATE TABLE IF NOT EXISTS ip_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cidr CIDR NOT NULL UNIQUE,
  action TEXT NOT NULL CHECK (action IN ('allow', 'deny')),
  reason TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,6}[0-9]{3,4}$'),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  description TEXT NOT NULL DEFAULT '',
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  lecturer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  credits INTEGER NOT NULL DEFAULT 3 CHECK (credits BETWEEN 1 AND 12),
  semester TEXT NOT NULL DEFAULT 'Semester 1',
  academic_year TEXT NOT NULL DEFAULT '2025/2026',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courses_lecturer_idx ON courses (lecturer_id);
CREATE INDEX IF NOT EXISTS courses_department_idx ON courses (department_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_id)
);
CREATE INDEX IF NOT EXISTS enrollments_course_idx ON enrollments (course_id);

CREATE TABLE IF NOT EXISTS grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL UNIQUE REFERENCES enrollments(id) ON DELETE CASCADE,
  score NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  letter_grade TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  graded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_policies (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_login_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_login_attempts BETWEEN 3 AND 20),
  lockout_minutes INTEGER NOT NULL DEFAULT 15 CHECK (lockout_minutes BETWEEN 1 AND 1440),
  challenge_after_failures INTEGER NOT NULL DEFAULT 3 CHECK (challenge_after_failures BETWEEN 1 AND 10),
  password_history_count INTEGER NOT NULL DEFAULT 5 CHECK (password_history_count BETWEEN 1 AND 20),
  session_timeout_minutes INTEGER NOT NULL DEFAULT 60 CHECK (session_timeout_minutes BETWEEN 5 AND 1440),
  require_mfa_for_admins BOOLEAN NOT NULL DEFAULT FALSE,
  require_mfa_for_lecturers BOOLEAN NOT NULL DEFAULT FALSE,
  password_max_age_days INTEGER NOT NULL DEFAULT 365 CHECK (password_max_age_days BETWEEN 30 AND 3650),
  login_ip_allowlist TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO security_policies (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'duplicate')),
  rejection_reason TEXT,
  source_ip INET,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_events_time_idx ON webhook_events (received_at DESC);

CREATE TABLE IF NOT EXISTS security_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_key TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'info')),
  description TEXT NOT NULL,
  procedure TEXT NOT NULL,
  expected TEXT NOT NULL,
  actual TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_by UUID REFERENCES users(id) ON DELETE SET NULL,
  source_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_test_runs_time_idx ON security_test_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  row_pk TEXT,
  old_data JSONB,
  new_data JSONB,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_table_idx ON audit_log (table_name);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS departments_set_updated_at ON departments;
CREATE TRIGGER departments_set_updated_at BEFORE UPDATE ON departments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS courses_set_updated_at ON courses;
CREATE TRIGGER courses_set_updated_at BEFORE UPDATE ON courses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS grades_set_updated_at ON grades;
CREATE TRIGGER grades_set_updated_at BEFORE UPDATE ON grades
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Consistent letter-grade calculation in the database as defence in depth.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_letter_grade() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.letter_grade := CASE
    WHEN NEW.score >= 90 THEN 'A'
    WHEN NEW.score >= 80 THEN 'B'
    WHEN NEW.score >= 70 THEN 'C'
    WHEN NEW.score >= 60 THEN 'D'
    ELSE 'F'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grades_letter_grade ON grades;
CREATE TRIGGER grades_letter_grade BEFORE INSERT OR UPDATE OF score ON grades
FOR EACH ROW EXECUTE FUNCTION calculate_letter_grade();

-- -----------------------------------------------------------------------------
-- Append-only security tables. Ordinary application users cannot UPDATE/DELETE,
-- and these triggers block even a role that is accidentally granted DML.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_append_only_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Security audit records are append-only and cannot be modified'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS security_events_append_only ON security_events;
CREATE TRIGGER security_events_append_only BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

DROP TRIGGER IF EXISTS login_attempts_append_only ON login_attempts;
CREATE TRIGGER login_attempts_append_only BEFORE UPDATE OR DELETE ON login_attempts
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

DROP TRIGGER IF EXISTS webhook_events_append_only ON webhook_events;
CREATE TRIGGER webhook_events_append_only BEFORE UPDATE OR DELETE ON webhook_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

DROP TRIGGER IF EXISTS security_test_runs_append_only ON security_test_runs;
CREATE TRIGGER security_test_runs_append_only BEFORE UPDATE OR DELETE ON security_test_runs
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

-- -----------------------------------------------------------------------------
-- Database-level audit of sensitive row changes. SECURITY DEFINER allows the
-- least-privilege app role to cause an audit insert without granting it direct
-- INSERT on audit_log. Sensitive columns are stripped from the row snapshots.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_sensitive_row() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_pk TEXT;
BEGIN
  v_old := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_new := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;

  IF TG_TABLE_NAME = 'users' THEN
    v_old := v_old - ARRAY['password_hash', 'mfa_secret_enc', 'mfa_pending_secret_enc', 'address', 'phone'];
    v_new := v_new - ARRAY['password_hash', 'mfa_secret_enc', 'mfa_pending_secret_enc', 'address', 'phone'];
  END IF;

  v_pk := COALESCE(v_new ->> 'id', v_old ->> 'id', v_new ->> 'enrollment_id', v_old ->> 'enrollment_id');

  INSERT INTO audit_log (table_name, operation, row_pk, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    v_pk,
    v_old,
    v_new,
    COALESCE(current_setting('ssims.actor_id', true), 'database')
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_users_changes ON users;
CREATE TRIGGER audit_users_changes AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_sensitive_row();

DROP TRIGGER IF EXISTS audit_grades_changes ON grades;
CREATE TRIGGER audit_grades_changes AFTER INSERT OR UPDATE OR DELETE ON grades
FOR EACH ROW EXECUTE FUNCTION audit_sensitive_row();

DROP TRIGGER IF EXISTS audit_courses_changes ON courses;
CREATE TRIGGER audit_courses_changes AFTER INSERT OR UPDATE OR DELETE ON courses
FOR EACH ROW EXECUTE FUNCTION audit_sensitive_row();

DROP TRIGGER IF EXISTS audit_enrollments_changes ON enrollments;
CREATE TRIGGER audit_enrollments_changes AFTER INSERT OR UPDATE OR DELETE ON enrollments
FOR EACH ROW EXECUTE FUNCTION audit_sensitive_row();

DROP TRIGGER IF EXISTS audit_departments_changes ON departments;
CREATE TRIGGER audit_departments_changes AFTER INSERT OR UPDATE OR DELETE ON departments
FOR EACH ROW EXECUTE FUNCTION audit_sensitive_row();
