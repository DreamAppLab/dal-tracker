import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { calendarAuth, db } from '../firebase';
import { useAuth } from './AuthContext';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  arrayRemove,
  doc,
  onSnapshot,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { assignAccountColor } from '../data/calendarColors';

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const GoogleCalendarContext = createContext(null);

function createGoogleCalendarProvider() {
  const provider = new GoogleAuthProvider();
  provider.addScope(GOOGLE_CALENDAR_SCOPE);
  provider.setCustomParameters({ prompt: 'consent', access_type: 'offline' });
  return provider;
}

function extractOAuthAccessToken(result) {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    return credential.accessToken;
  }
  return result?._tokenResponse?.oauthAccessToken || null;
}

function extractOAuthRefreshToken(result) {
  return (
    result?._tokenResponse?.oauthRefreshToken ||
    result?._tokenResponse?.refreshToken ||
    ''
  );
}

function tokensRef(userId) {
  return doc(db, 'calendarTokens', userId);
}

export function GoogleCalendarProvider({ children }) {
  const { user } = useAuth();
  const accountsRef = useRef([]);
  const refreshedOnLoadRef = useRef(new Set());
  const refreshingRef = useRef(new Set());
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [connectTimedOut, setConnectTimedOut] = useState(false);
  const [error, setError] = useState(null);

  accountsRef.current = connectedAccounts;

  useEffect(() => {
    if (!connecting) return undefined;
    const timeoutId = window.setTimeout(() => {
      setConnecting(false);
      setConnectTimedOut(true);
      setError((prev) => prev || 'Connection timed out. Try again.');
    }, 15000);
    return () => window.clearTimeout(timeoutId);
  }, [connecting]);

  useEffect(() => {
    if (!user?.uid) {
      setConnectedAccounts([]);
      refreshedOnLoadRef.current.clear();
      return undefined;
    }
    const unsub = onSnapshot(
      tokensRef(user.uid),
      (snapshot) => {
        const accounts = snapshot.exists() ? snapshot.data().accounts || [] : [];
        setConnectedAccounts(accounts);
      },
      (err) => {
        setError(err.message || 'Failed to load calendar tokens');
      }
    );
    return () => unsub();
  }, [user?.uid]);

  const refreshAccessToken = useCallback(async (account) => {
    if (!account?.refreshToken || !user?.uid) return null;
    try {
      const response = await fetch('/api/refresh-calendar-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: account.refreshToken }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.access_token) return null;
      const tokenIssuedAt = Date.now();
      const updatedAccount = {
        ...account,
        accessToken: data.access_token,
        tokenIssuedAt,
        token_issued_at: tokenIssuedAt,
      };
      const accounts = accountsRef.current.map((a) =>
        a.email === account.email ? updatedAccount : a
      );
      await setDoc(tokensRef(user.uid), { accounts }, { merge: true });
      return updatedAccount.accessToken;
    } catch {
      return null;
    }
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !connectedAccounts.length) return;
    connectedAccounts.forEach((account) => {
      if (!account.refreshToken) return;
      const key = `${user.uid}:${account.email}`;
      if (refreshedOnLoadRef.current.has(key) || refreshingRef.current.has(key)) return;
      refreshedOnLoadRef.current.add(key);
      refreshingRef.current.add(key);
      void refreshAccessToken(account).finally(() => {
        refreshingRef.current.delete(key);
      });
    });
  }, [connectedAccounts, refreshAccessToken, user?.uid]);

  const authorizedCalendarFetch = useCallback(async (account, url, options = {}) => {
    const withToken = (token) =>
      fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });
    let res = await withToken(account.accessToken);
    if (res.status === 401 && account.refreshToken) {
      const nextToken = await refreshAccessToken(account);
      if (nextToken) {
        res = await withToken(nextToken);
      }
    }
    return res;
  }, [refreshAccessToken]);

  const connectAccount = useCallback(async () => {
    if (!user?.uid) {
      setError('You must be signed in to connect a calendar.');
      return;
    }
    setConnecting(true);
    setConnectTimedOut(false);
    setError(null);
    try {
      const provider = createGoogleCalendarProvider();
      const result = await signInWithPopup(calendarAuth, provider);
      const token = extractOAuthAccessToken(result);
      const refreshToken = extractOAuthRefreshToken(result);
      const email = result.user?.email;

      await signOut(calendarAuth);

      if (!token) {
        throw new Error('No OAuth access token received. Calendar scope may not have been granted.');
      }
      if (!email) {
        throw new Error('No email received from Google sign-in.');
      }

      const existing = connectedAccounts.find((a) => a.email === email);
      const color = existing?.color ?? assignAccountColor(
        connectedAccounts.filter((a) => a.email !== email).length
      );
      const tokenIssuedAt = Date.now();
      const nextAccount = {
        email,
        accessToken: token,
        refreshToken: refreshToken || existing?.refreshToken || '',
        color,
        connectedAt: existing?.connectedAt || Timestamp.now(),
        tokenIssuedAt,
        token_issued_at: tokenIssuedAt,
      };
      const accounts = [
        ...connectedAccounts.filter((a) => a.email !== email),
        nextAccount,
      ];
      await setDoc(tokensRef(user.uid), { accounts }, { merge: true });
    } catch (err) {
      try {
        await signOut(calendarAuth);
      } catch {
        /* secondary session cleanup is best-effort */
      }
      setError(err.message || 'Failed to connect Google Calendar');
    } finally {
      setConnecting(false);
    }
  }, [connectedAccounts, user?.uid]);

  const disconnectAccount = useCallback(async (email) => {
    if (!user?.uid) return;
    setError(null);
    const account = connectedAccounts.find((a) => a.email === email);
    if (!account) return;
    await updateDoc(tokensRef(user.uid), { accounts: arrayRemove(account) });
  }, [connectedAccounts, user?.uid]);

  return (
    <GoogleCalendarContext.Provider
      value={{
        connectedAccounts,
        connecting,
        connectTimedOut,
        error,
        setError,
        connectAccount,
        disconnectAccount,
        refreshAccessToken,
        authorizedCalendarFetch,
      }}
    >
      {children}
    </GoogleCalendarContext.Provider>
  );
}

export function useGoogleCalendar() {
  const ctx = useContext(GoogleCalendarContext);
  if (!ctx) {
    throw new Error('useGoogleCalendar must be used within GoogleCalendarProvider');
  }
  return ctx;
}

export { GOOGLE_CALENDAR_SCOPE, createGoogleCalendarProvider, extractOAuthAccessToken };
