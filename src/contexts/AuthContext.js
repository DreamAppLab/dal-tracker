import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { auth } from '../firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const credentialsRef = useRef(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

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
    <AuthContext.Provider value={{ user, authLoading, login, logout, relogin }}>
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
