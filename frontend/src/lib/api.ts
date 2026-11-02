import type {
  AppConfigResponse,
  AuditLogChunk,
  AuditProgress,
  AuditRecord,
  AuditResultsResponse,
  AuditSettings,
  DashboardResponse
} from '../../../backend/src/apiTypes';

export type * from '../../../backend/src/apiTypes';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => undefined;

/** Called by the auth provider so any expired session returns the user to the sign-in screen. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers }
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the audit backend. Make sure it is running.');
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`);
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  login: (userId: string, password: string) => post<{ userId: string }>('/auth/login', { userId, password }),
  logout: () => post<void>('/auth/logout'),
  session: () => request<{ userId: string }>('/auth/session'),
  config: () => request<AppConfigResponse>('/config'),
  dashboard: () => request<DashboardResponse>('/dashboard'),
  audits: () => request<AuditRecord[]>('/audits'),
  audit: (id: string) => request<AuditRecord>(`/audits/${id}`),
  progress: (id: string) => request<AuditProgress>(`/audits/${id}/progress`),
  log: (id: string, from?: number) => request<AuditLogChunk>(`/audits/${id}/log${from === undefined ? '' : `?from=${from}`}`),
  results: (id: string) => request<AuditResultsResponse>(`/audits/${id}/results`),
  startAudit: (settings: AuditSettings) => post<AuditRecord>('/audits', settings),
  cancel: (id: string) => post<AuditRecord>(`/audits/${id}/cancel`),
  rerun: (id: string) => post<AuditRecord>(`/audits/${id}/rerun`)
};

/** URL of a file in an audit's saved snapshot (reports/... or screenshots/...). */
export function fileUrl(auditId: string, relativePath: string, download = false): string {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return `/api/audits/${auditId}/files/${encoded}${download ? '?download' : ''}`;
}

export function screenshotsZipUrl(auditId: string): string {
  return `/api/audits/${auditId}/screenshots.zip`;
}

/** PDF of an engine HTML report, rendered by the backend. */
export function reportPdfUrl(auditId: string, reportPath = 'reports/website-audit-report.html'): string {
  return `/api/audits/${auditId}/report.pdf?path=${encodeURIComponent(reportPath)}`;
}
