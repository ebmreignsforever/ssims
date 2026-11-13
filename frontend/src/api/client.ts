import type { ApiEnvelope, User } from '../types';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
let csrfToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export interface SessionPayload {
  user: User;
  accessToken: string;
  csrfToken: string;
  expiresIn: number;
}

export function setSessionTokens(token: string, csrf: string): void {
  // Access tokens intentionally live only in memory, never localStorage.
  accessToken = token;
  csrfToken = csrf;
}

export function clearSessionTokens(): void {
  accessToken = null;
  csrfToken = null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

function getCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

function activeCsrf(): string | null {
  return csrfToken || getCookie('ssims_csrf');
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  retryOn401?: boolean;
  signal?: AbortSignal;
}

async function parseResponse<T>(response: Response): Promise<ApiEnvelope<T>> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, 'HTTP_ERROR', text || 'Request failed');
    return { success: true, data: text as T };
  }
  const payload = (await response.json()) as ApiEnvelope<T> & {
    error?: { code?: string; message?: string; details?: unknown };
  };
  if (!response.ok || payload.success === false) {
    throw new ApiError(
      response.status,
      payload.error?.code || 'REQUEST_FAILED',
      payload.error?.message || 'The request could not be completed',
      payload.error?.details,
    );
  }
  return payload;
}

export async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const csrf = activeCsrf();
    if (!csrf) return false;
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': csrf,
        },
      });
      if (!response.ok) {
        clearSessionTokens();
        return false;
      }
      const payload = await parseResponse<SessionPayload>(response);
      setSessionTokens(payload.data.accessToken, payload.data.csrfToken);
      return true;
    } catch {
      clearSessionTokens();
      return false;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = activeCsrf();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the SSIMS API. Check your network connection.');
  }

  if (response.status === 401 && options.retryOn401 !== false && options.auth !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiRequest<T>(path, { ...options, retryOn401: false });
    clearSessionTokens();
    window.dispatchEvent(new CustomEvent('ssims:session-expired'));
  }

  return parseResponse<T>(response);
}

export const api = {
  get: async <T>(path: string): Promise<T> => (await apiRequest<T>(path)).data,
  getWithMeta: <T>(path: string) => apiRequest<T>(path),
  post: async <T>(path: string, body?: unknown, options?: Partial<RequestOptions>): Promise<T> =>
    (await apiRequest<T>(path, { method: 'POST', body, ...options })).data,
  patch: async <T>(path: string, body?: unknown): Promise<T> =>
    (await apiRequest<T>(path, { method: 'PATCH', body })).data,
  delete: async <T>(path: string): Promise<T> =>
    (await apiRequest<T>(path, { method: 'DELETE' })).data,
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.details === undefined || error.details === null) return {};
  const output: Record<string, string> = {};
  if (Array.isArray(error.details)) {
    for (const entry of error.details as { field?: string; message?: string }[]) {
      if (entry.field) output[entry.field] = entry.message || 'Invalid value';
    }
    return output;
  }
  if (typeof error.details !== 'object') return output;
  const details = error.details as Record<string, unknown>;
  if (Array.isArray(details.errors)) {
    for (const entry of details.errors as { field?: string; message?: string }[]) {
      if (entry.field) output[entry.field] = entry.message || 'Invalid value';
    }
    return output;
  }
  for (const [field, message] of Object.entries(details)) {
    if (typeof message === 'string') output[field] = message;
    else if (Array.isArray(message) && typeof message[0] === 'string') output[field] = message[0];
  }
  return output;
}

export async function downloadSecurityCsv(path: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let response = await fetch(`/api${path}`, { credentials: 'include', headers });
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed && accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
      response = await fetch(`/api${path}`, { credentials: 'include', headers });
    }
  }
  if (!response.ok) throw new ApiError(response.status, 'EXPORT_FAILED', 'Could not export the security log');
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || 'ssims-security-events.csv';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
