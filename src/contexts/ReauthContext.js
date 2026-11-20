// "Recent sign-in required" for sensitive actions (vault reveals, deletes, …).
//
//   const { requireRecentAuth } = useRecentAuth();
//   await requireRecentAuth(5 * 60);   // resolves once the sign-in is < 5 min old
//
// If the current sign-in is older than the limit, a dialog asks the user to
// confirm it's them (Google popup or password). Servers enforce the same rule
// independently by checking the ID token's auth_time; apiFetch() calls back
// into this provider automatically when a server says recent_auth_required.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { auth } from '../firebase';
import { setReauthHandler } from '../lib/apiClient';
import { markActivity } from './AuthContext';

const ReauthContext = createContext(null);

// Allow for clock skew between browser and server.
const SKEW_SECONDS = 30;

export async function secondsSinceSignIn() {
  const user = auth.currentUser;
  if (!user) return Infinity;
  const result = await user.getIdTokenResult();
  const authTime = Number(result.claims.auth_time);
  if (!authTime) return Infinity;
  return Math.floor(Date.now() / 1000) - authTime;
}

export function ReauthProvider({ children }) {
  const [request, setRequest] = useState(null); // { resolve, reject }
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef(null);

  const openDialog = useCallback(() => {
    if (pendingRef.current) return pendingRef.current;
    const promise = new Promise((resolve, reject) => {
      setPassword('');
      setError('');
      setRequest({ resolve, reject });
    }).finally(() => {
      pendingRef.current = null;
    });
    pendingRef.current = promise;
    return promise;
  }, []);

  const requireRecentAuth = useCallback(
    async (maxAgeSeconds = 300) => {
      const age = await secondsSinceSignIn();
      if (age <= maxAgeSeconds - SKEW_SECONDS) return;
      await openDialog();
    },
    [openDialog]
  );

  useEffect(() => setReauthHandler(() => openDialog()), [openDialog]);

  const user = auth.currentUser;
  const providers = (user && user.providerData ? user.providerData : []).map((p) => p.providerId);
  const hasGoogle = providers.includes('google.com');
  const hasPassword = providers.includes('password');

  const finish = useCallback(async () => {
    await auth.currentUser.getIdToken(true);
    markActivity();
    const r = request;
    setRequest(null);
    setPassword('');
    if (r) r.resolve();
  }, [request]);

  const withGoogle = async () => {
    setBusy(true);
    setError('');
    try {
      await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
      await finish();
    } catch (e) {
      setError(e && e.code === 'auth/user-mismatch' ? 'Use the same Google account you are signed in with.' : 'Google confirmation failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const withPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, password);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await finish();
    } catch {
      setError('That password is not correct.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    const r = request;
    setRequest(null);
    setPassword('');
    if (r) r.reject(Object.assign(new Error('Sign-in confirmation cancelled'), { code: 'reauth-cancelled' }));
  };

  return (
    <ReauthContext.Provider value={{ requireRecentAuth }}>
      {children}
      {request && (
        <div className="modal-overlay reauth-overlay" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
          <div className="reauth-card">
            <h2 id="reauth-title" className="reauth-title">Confirm it’s you</h2>
            <p className="reauth-text">
              This action needs a recent sign-in. Confirm your identity to continue.
            </p>
            {hasGoogle && (
              <button type="button" className="btn btn-primary reauth-btn" onClick={withGoogle} disabled={busy}>
                Continue with Google
              </button>
            )}
            {hasPassword && (
              <form className="reauth-form" onSubmit={withPassword}>
                <label className="reauth-label" htmlFor="reauth-password">
                  Password for {user && user.email}
                </label>
                <input
                  id="reauth-password"
                  type="password"
                  className="form-input"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus={!hasGoogle}
                  required
                />
                <button type="submit" className="btn btn-primary reauth-btn" disabled={busy || !password}>
                  {busy ? 'Confirming…' : 'Confirm'}
                </button>
              </form>
            )}
            {error && <p className="reauth-error">{error}</p>}
            <button type="button" className="btn btn-ghost reauth-btn" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </ReauthContext.Provider>
  );
}

export function useRecentAuth() {
  const ctx = useContext(ReauthContext);
  if (!ctx) throw new Error('useRecentAuth must be used within ReauthProvider');
  return ctx;
}
