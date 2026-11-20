import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { apiFetch } from '../lib/apiClient';

const AUTH_TIMEOUT_MS = 8000;

// Idle sign-out: Mission Control holds financial data, so an unattended,
// signed-in browser is signed out after 30 minutes without activity.
// Activity is shared across tabs through localStorage.
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ACTIVITY_KEY = 'mc:lastActivity';
const AUDITED_AUTH_TIME_KEY = 'mc:auditedAuthTime';
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'pointermove'];
const ACTIVITY_WRITE_THROTTLE_MS = 15 * 1000;
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;

function readLastActivity() {
  try {
    const v = Number(window.localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function markActivity(now = Date.now()) {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(now));
  } catch {
    /* storage unavailable — idle timer falls back to this tab only */
  }
}

export function isIdle(now = Date.now(), last = readLastActivity()) {
  return last != null && now - last > IDLE_TIMEOUT_MS;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [signOutReason, setSignOutReason] = useState(null);
  const lastWriteRef = useRef(0);

  const retryAuth = useCallback(() => {
    setAuthError(null);
    setAuthTimedOut(false);
    setAuthLoading(true);
    setRetryCount((c) => c + 1);
  }, []);

  const signOutForIdle = useCallback(async () => {
    setSignOutReason('idle');
    try {
      window.localStorage.removeItem(ACTIVITY_KEY);
    } catch {
      /* ignore */
    }
    await signOut(auth).catch(() => {});
  }, []);

  // Record each fresh sign-in once (auditLog + sign-in alert email, server-side).
  const recordSignIn = useCallback(async (firebaseUser) => {
    try {
      const result = await firebaseUser.getIdTokenResult();
      const authTime = String(result.claims.auth_time || '');
      if (!authTime || window.localStorage.getItem(AUDITED_AUTH_TIME_KEY) === authTime) return;
      const res = await apiFetch('/api/auth/sign-in', { method: 'POST' });
      if (res.ok) window.localStorage.setItem(AUDITED_AUTH_TIME_KEY, authTime);
    } catch (e) {
      console.warn('Sign-in audit failed:', e && e.message);
    }
  }, []);

  useEffect(() => {
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        setAuthTimedOut(true);
        setAuthLoading(false);
      }
    }, AUTH_TIMEOUT_MS);

    const unsub = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        resolved = true;
        clearTimeout(timeoutId);
        // A persisted session that has been idle too long (e.g. the laptop was
        // closed overnight) is ended before any data loads.
        if (firebaseUser && isIdle()) {
          setUser(null);
          setAuthLoading(false);
          signOutForIdle();
          return;
        }
        if (firebaseUser) {
          if (readLastActivity() == null) markActivity();
          recordSignIn(firebaseUser);
        }
        setUser(firebaseUser);
        setAuthLoading(false);
        setAuthError(null);
        setAuthTimedOut(false);
      },
      (error) => {
        resolved = true;
        clearTimeout(timeoutId);
        setAuthError(error);
        setAuthLoading(false);
      }
    );

    return () => {
      clearTimeout(timeoutId);
      unsub();
    };
  }, [retryCount, recordSignIn, signOutForIdle]);

  // Activity tracking + periodic idle check while signed in.
  useEffect(() => {
    if (!user) return undefined;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWriteRef.current = now;
      markActivity(now);
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
    const intervalId = setInterval(() => {
      if (isIdle()) signOutForIdle();
    }, IDLE_CHECK_INTERVAL_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
      clearInterval(intervalId);
    };
  }, [user, signOutForIdle]);

  // Returning to the tab: sign out if idle too long, otherwise refresh the
  // token (keeps the earlier "black screen after inactivity" fix working).
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      const currentUser = auth.currentUser;
      if (currentUser && isIdle()) {
        signOutForIdle();
        return;
      }
      try {
        if (currentUser) {
          await currentUser.getIdToken(true);
        } else {
          retryAuth();
        }
      } catch {
        retryAuth();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [retryAuth, signOutForIdle]);

  const login = useCallback(async (email, password) => {
    markActivity();
    setSignOutReason(null);
    return signInWithEmailAndPassword(auth, email, password);
  }, []);

  const logout = useCallback(async () => {
    setSignOutReason(null);
    try {
      window.localStorage.removeItem(ACTIVITY_KEY);
    } catch {
      /* ignore */
    }
    await signOut(auth);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, authLoading, authError, authTimedOut, retryAuth, login, logout, signOutReason, setSignOutReason }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
