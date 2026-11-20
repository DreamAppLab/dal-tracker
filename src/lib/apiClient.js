// Authenticated calls to Mission Control's own /api functions.
//
// Every API function verifies the Firebase ID token server-side, so every
// call from the app must go through apiFetch(). Never call fetch('/api/...')
// directly, and never put a secret in client code: anything in src/ ships to
// the browser.

import { auth } from '../firebase';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
    this.code = body && body.code;
  }
}

// Set by <ReauthProvider>: shows the "confirm it's you" dialog and resolves
// once the user has signed in again (rejects if they cancel).
let reauthHandler = null;
export function setReauthHandler(fn) {
  reauthHandler = fn;
  return () => {
    if (reauthHandler === fn) reauthHandler = null;
  };
}

async function authHeader(forceRefresh = false) {
  const user = auth.currentUser;
  if (!user) throw new ApiError('Not signed in', 401);
  const token = await user.getIdToken(forceRefresh);
  return `Bearer ${token}`;
}

/**
 * fetch() wrapper for /api routes: adds the Firebase ID token.
 * Returns the raw Response (same contract as fetch) so existing callers keep working.
 */
export async function apiFetch(path, options = {}) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    throw new Error('apiFetch only calls Mission Control /api routes');
  }
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', await authHeader());
  let res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => ({}));
    if (body && body.code === 'recent_auth_required') {
      // Sensitive action: ask the user to confirm their sign-in, then retry once.
      if (!reauthHandler) return res;
      await reauthHandler(body.maxAgeSeconds || 300);
    }
    // Expired token, or freshly re-authenticated: retry once with a new token.
    headers.set('Authorization', await authHeader(true));
    res = await fetch(path, { ...options, headers });
  }
  return res;
}

/** JSON convenience: throws ApiError on non-2xx. */
export async function apiJson(path, options = {}) {
  const opts = { ...options };
  if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
    opts.body = JSON.stringify(opts.body);
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  }
  const res = await apiFetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}
