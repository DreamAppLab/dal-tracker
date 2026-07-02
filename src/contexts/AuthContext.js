import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { auth } from '../firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

const AUTH_TIMEOUT_MS = 8000;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const credentialsRef = useRef(null);

  const retryAuth = useCallback(() => {
    setAuthError(null);
    setAuthTimedOut(false);
    setAuthLoading(true);
    setRetryCount((c) => c + 1);
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
  }, [retryCount]);

  const login = useCallback(async (email, password) => {
    const result = await signInWithEmailAndPassword(auth, email, password);
    credentialsRef.current = { email, password };
    return result;
  }, []);

  const logout = useCallback(async () => {
    credentialsRef.current = null;
    await signOut(auth);
  }, []);

  const relogin = useCallback(async () => {
    const creds = credentialsRef.current;
    if (!creds) return;
    await signInWithEmailAndPassword(auth, creds.email, creds.password);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, authLoading, authError, authTimedOut, retryAuth, login, logout, relogin }}
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
