import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [connectTimedOut, setConnectTimedOut] = useState(false);
  const [error, setError] = useState(null);

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

  // Token refresh requires REACT_APP_GOOGLE_CLIENT_ID and REACT_APP_GOOGLE_CLIENT_SECRET.
  const refreshAccessToken = useCallback(async (account) => {
    if (!account.refreshToken) return null;
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.REACT_APP_GOOGLE_CLIENT_ID,
          client_secret: process.env.REACT_APP_GOOGLE_CLIENT_SECRET,
          refresh_token: account.refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.access_token) return null;
      const updatedAccount = {
        ...account,
        accessToken: data.access_token,
        expiresAt: Timestamp.fromMillis(Date.now() + (data.expires_in ?? 3600) * 1000),
      };
      const accounts = [
        ...connectedAccounts.filter((a) => a.email !== account.email),
        updatedAccount,
      ];
      await setDoc(tokensRef(user.uid), { accounts }, { merge: true });
      return updatedAccount.accessToken;
    } catch {
      return null;
    }
  }, [connectedAccounts, user?.uid]);

  useEffect(() => {
    if (!connectedAccounts.length) return;
    const fiveMinutes = 5 * 60 * 1000;
    connectedAccounts.forEach((account) => {
      if (!account.expiresAt) return;
      const expiresAt = account.expiresAt?.toMillis?.() ?? 0;
      if (expiresAt - Date.now() < fiveMinutes) {
        void refreshAccessToken(account);
      }
    });
  }, [connectedAccounts, refreshAccessToken]);

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
      const nextAccount = {
        expiresAt: Timestamp.fromMillis(Date.now() + 3600 * 1000),
        email,
        accessToken: token,
        refreshToken: refreshToken || existing?.refreshToken || '',
        color,
        connectedAt: existing?.connectedAt || Timestamp.now(),
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
