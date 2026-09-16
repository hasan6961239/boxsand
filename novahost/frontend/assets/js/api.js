/**
 * API client.
 *
 * Every request in the dashboard goes through here — there are no scattered
 * fetch() calls in the views. That gives one place to attach the CSRF token,
 * one place to unwrap the { success, data } envelope, and one place to notice
 * that the session expired and send the user back to the login screen.
 */

class ApiError extends Error {
  constructor(code, message, { status = 0, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let csrfToken = null;
const unauthorizedHandlers = new Set();

export function setCsrfToken(token) {
  csrfToken = token ?? null;
}

export function getCsrfToken() {
  return csrfToken;
}

/** Called when the server says the session is gone, so the shell can react. */
export function onUnauthorized(handler) {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

function notifyUnauthorized() {
  for (const handler of unauthorizedHandlers) {
    try { handler(); } catch { /* a listener must not break the request */ }
  }
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (response.status === 204) return null;
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    if (response.ok) return text;
    throw new ApiError('UNEXPECTED_RESPONSE', text.slice(0, 200) || response.statusText, {
      status: response.status,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('INVALID_JSON', 'The server sent a malformed response', { status: response.status });
  }

  if (response.ok && payload?.success) return payload.data;

  const error = payload?.error ?? {};
  if (response.status === 401) notifyUnauthorized();
  throw new ApiError(
    error.code ?? 'UNKNOWN_ERROR',
    error.message ?? response.statusText,
    { status: response.status, details: error.details ?? null },
  );
}

async function request(path, { method = 'GET', body = null, headers = {}, signal = null, raw = false } = {}) {
  const requestHeaders = { ...headers };

  // Marks the request as coming from a script, which combines with the
  // server-side Origin check as another layer of CSRF defence.
  requestHeaders['X-Requested-With'] = 'XMLHttpRequest';

  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    requestHeaders['X-CSRF-Token'] = csrfToken;
  }

  let payload = body;
  if (body !== null && !raw && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    requestHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers: requestHeaders,
      body: payload,
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('NETWORK_ERROR', 'Could not reach the server', { status: 0 });
  }

  return parseResponse(response);
}

/**
 * Upload with progress.
 *
 * fetch() still cannot report upload progress, so this one call uses XHR. It is
 * the only place in the frontend that does, and it is worth it: watching a
 * 40 MB zip crawl over Wi-Fi with no feedback is a bad experience.
 */
export function upload(path, file, { method = 'POST', contentType = 'application/zip', onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total, event.loaded, event.total);
      });
    }

    xhr.addEventListener('load', () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch { /* handled below */ }

      if (xhr.status >= 200 && xhr.status < 300 && payload?.success) {
        resolve(payload.data);
        return;
      }
      if (xhr.status === 401) notifyUnauthorized();
      const error = payload?.error ?? {};
      reject(new ApiError(
        error.code ?? 'UPLOAD_FAILED',
        error.message ?? `Upload failed (HTTP ${xhr.status})`,
        { status: xhr.status, details: error.details ?? null },
      ));
    });

    xhr.addEventListener('error', () => {
      reject(new ApiError('NETWORK_ERROR', 'Could not reach the server', { status: 0 }));
    });
    xhr.addEventListener('abort', () => {
      reject(new ApiError('UPLOAD_ABORTED', 'Upload cancelled', { status: 0 }));
    });

    xhr.send(file);
  });
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  ApiError,

  // ---- setup & auth ----
  setupStatus: () => request('/api/setup/status'),
  setup: (body) => request('/api/setup', { method: 'POST', body }),
  login: (body) => request('/api/auth/login', { method: 'POST', body }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  updateProfile: (body) => request('/api/auth/profile', { method: 'PATCH', body }),
  changePassword: (body) => request('/api/auth/password', { method: 'POST', body }),
  sessions: () => request('/api/auth/sessions'),
  revokeSession: (id) => request(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---- projects ----
  projects: (params) => request(`/api/projects${qs(params)}`),
  project: (id) => request(`/api/projects/${encodeURIComponent(id)}`),
  createProject: (body) => request('/api/projects', { method: 'POST', body }),
  updateProject: (id, body) => request(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  setProjectEnabled: (id, enabled) =>
    request(`/api/projects/${encodeURIComponent(id)}/enabled`, { method: 'POST', body: { enabled } }),
  deleteProject: (id, confirm) =>
    request(`/api/projects/${encodeURIComponent(id)}${qs({ confirm })}`, { method: 'DELETE' }),
  projectStats: (id) => request(`/api/projects/${encodeURIComponent(id)}/stats`),
  slugPreview: (name) => request(`/api/slug-preview${qs({ name })}`),

  // ---- deployments ----
  deploy: (id, file, { message = '', onProgress } = {}) =>
    upload(`/api/projects/${encodeURIComponent(id)}/deploy${qs({ message })}`, file, { onProgress }),
  publishWorkspace: (id, message) =>
    request(`/api/projects/${encodeURIComponent(id)}/publish`, { method: 'POST', body: { message } }),
  deployments: (id, params) => request(`/api/projects/${encodeURIComponent(id)}/deployments${qs(params)}`),
  recentDeployments: (params) => request(`/api/deployments${qs(params)}`),
  deployment: (deploymentId) => request(`/api/deployments/${encodeURIComponent(deploymentId)}`),
  deploymentLogs: (deploymentId) => request(`/api/deployments/${encodeURIComponent(deploymentId)}/logs`),
  rollback: (id, deploymentId) =>
    request(`/api/projects/${encodeURIComponent(id)}/rollback`, { method: 'POST', body: { deploymentId } }),
  downloadProjectUrl: (id) => `/api/projects/${encodeURIComponent(id)}/download`,

  // ---- files ----
  files: (id, path = '') => request(`/api/projects/${encodeURIComponent(id)}/files${qs({ path })}`),
  fileContent: (id, path) => request(`/api/projects/${encodeURIComponent(id)}/files/content${qs({ path })}`),
  fileRawUrl: (id, path, download = false) =>
    `/api/projects/${encodeURIComponent(id)}/files/raw${qs({ path, download: download ? 1 : '' })}`,
  saveFile: (id, path, content) =>
    request(`/api/projects/${encodeURIComponent(id)}/files${qs({ path })}`, {
      method: 'PUT',
      body: content,
      raw: true,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
  uploadFile: (id, path, file, onProgress) =>
    upload(`/api/projects/${encodeURIComponent(id)}/files${qs({ path })}`, file, {
      method: 'PUT',
      contentType: file.type || 'application/octet-stream',
      onProgress,
    }),
  createFolder: (id, path) =>
    request(`/api/projects/${encodeURIComponent(id)}/files/folder`, { method: 'POST', body: { path } }),
  renameFile: (id, from, to) =>
    request(`/api/projects/${encodeURIComponent(id)}/files/rename`, { method: 'POST', body: { from, to } }),
  deleteFile: (id, path) =>
    request(`/api/projects/${encodeURIComponent(id)}/files${qs({ path })}`, { method: 'DELETE' }),
  discardChanges: (id) =>
    request(`/api/projects/${encodeURIComponent(id)}/files/discard`, { method: 'POST' }),

  // ---- domains ----
  domains: () => request('/api/domains'),
  addDomain: (projectId, hostname) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/domains`, { method: 'POST', body: { hostname } }),
  verifyDomain: (domainId) =>
    request(`/api/domains/${encodeURIComponent(domainId)}/verify`, { method: 'POST' }),
  deleteDomain: (domainId) =>
    request(`/api/domains/${encodeURIComponent(domainId)}`, { method: 'DELETE' }),

  // ---- server ----
  overview: () => request('/api/overview'),
  serverStats: () => request('/api/server/stats'),
  serverInfo: () => request('/api/server/info'),
  serverStorage: () => request('/api/server/storage'),
  rescanStorage: () => request('/api/server/rescan', { method: 'POST' }),
  cleanup: () => request('/api/server/cleanup', { method: 'POST' }),
  restart: () => request('/api/server/restart', { method: 'POST', body: { confirm: 'restart' } }),
  health: () => request('/health'),
  search: (q) => request(`/api/search${qs({ q })}`),

  // ---- logs ----
  logs: (params) => request(`/api/logs${qs(params)}`),
  clearLogs: (projectId) => request(`/api/logs${qs({ projectId })}`, { method: 'DELETE' }),
  securityLogs: (params) => request(`/api/logs/security${qs(params)}`),
  auditLogs: (params) => request(`/api/logs/audit${qs(params)}`),

  // ---- settings ----
  settings: () => request('/api/settings'),
  updateSettings: (body) => request('/api/settings', { method: 'PATCH', body }),

  // ---- backups ----
  backups: () => request('/api/backups'),
  createBackup: (body) => request('/api/backups', { method: 'POST', body }),
  backupDownloadUrl: (id) => `/api/backups/${encodeURIComponent(id)}/download`,
  deleteBackup: (id) => request(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreBackup: (file, onProgress) =>
    upload('/api/backups/restore?confirm=restore', file, { onProgress }),
};

export { ApiError };
