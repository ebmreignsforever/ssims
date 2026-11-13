export type Role = 'super_admin' | 'administrator' | 'lecturer' | 'student';
export type AccountStatus = 'active' | 'locked' | 'suspended' | 'pending';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: AccountStatus;
  studentId: string | null;
  staffId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  phone: string | null;
  address: string | null;
  programme: string | null;
  level: string | null;
  mfaEnabled: boolean;
  mfaEnrollmentRequired?: boolean;
  mustChangePassword: boolean;
  passwordExpired?: boolean;
  backupCodesRemaining: number;
  lastLoginAt: string | null;
  createdAt: string;
  permissions: string[];
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SecurityEvent {
  id: string;
  occurred_at: string;
  user_id: string | null;
  actor_email: string | null;
  ip: string | null;
  event_type: string;
  severity: Severity;
  description: string;
  metadata: Record<string, unknown>;
  request_id: string | null;
  user_agent: string | null;
  full_name: string | null;
}

export interface LabTestDefinition {
  key: string;
  name: string;
  category: string;
  description: string;
  procedure: string;
  expected: string;
  mechanism: string;
  safety: string;
}

export interface LabTestResult {
  id: string;
  testKey: string;
  name: string;
  status: 'passed' | 'failed' | 'info';
  description: string;
  procedure: string;
  expected: string;
  actual: string;
  mechanism: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  description: string;
  created_at?: string;
  student_count?: number;
  lecturer_count?: number;
  course_count?: number;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  description: string;
  credits: number;
  semester: string;
  academic_year: string;
  is_active: boolean;
  department_id: string;
  lecturer_id: string | null;
  department_name: string;
  department_code?: string;
  lecturer_name: string | null;
  student_count: number;
  graded_count: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  status: AccountStatus;
  student_id: string | null;
  staff_id: string | null;
  department_id: string | null;
  department_name: string | null;
  programme: string | null;
  level: string | null;
  mfa_enabled: boolean;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}
