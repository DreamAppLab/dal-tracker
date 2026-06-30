import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth } from '../firebase';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_STORAGE_KEY = 'dal-google-calendar-token';

const GoogleCalendarContext = createContext(null);

function createGoogleCalendarProvider() {
  const provider = new GoogleAuthProvider();
  provider.addScope(GOOGLE_CALENDAR_SCOPE);
  provider.setCustomParameters({ prompt: 'consent', access_type: 'online' });
  return provider;
}

function extractOAuthAccessToken(result) {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    return credential.accessToken;
  }
  return result?._tokenResponse?.oauthAccessToken || null;
}

function persistAccessToken(token) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

function clearPersistedAccessToken() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function GoogleCalendarProvider({ children }) {
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem(TOKEN_STORAGE_KEY));
  const [googleUser, setGoogleUser] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setGoogleUser(user);
      const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored) {
        setAccessToken(stored);
      }
    });
    return () => unsub();
  }, []);

  const connectGoogle = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      // Sign out first so Google re-prompts with calendar.readonly scope
      await signOut(auth);
      clearPersistedAccessToken();
      setAccessToken(null);

      const provider = createGoogleCalendarProvider();
      const result = await signInWithPopup(auth, provider);
      const token = extractOAuthAccessToken(result);

      if (!token) {
        throw new Error('No OAuth access token received. Calendar scope may not have been granted.');
      }

      persistAccessToken(token);
      setAccessToken(token);
      setGoogleUser(result.user);
    } catch (err) {
      setError(err.message || 'Failed to connect Google Calendar');
      clearPersistedAccessToken();
      setAccessToken(null);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnectGoogle = useCallback(async () => {
    clearPersistedAccessToken();
    setAccessToken(null);
    setError(null);
    try {
      await signOut(auth);
    } catch {
      // ignore sign-out errors
    }
    setGoogleUser(null);
  }, []);

  return (
    <GoogleCalendarContext.Provider
      value={{
        accessToken,
        googleUser,
        connecting,
        error,
        setError,
        connectGoogle,
        disconnectGoogle,
        isConnected: !!accessToken,
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

export { GOOGLE_CALENDAR_SCOPE, TOKEN_STORAGE_KEY };
