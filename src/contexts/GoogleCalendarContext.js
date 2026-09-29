import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth, db } from '../firebase';
import { useAuth } from './AuthContext';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { assignAccountColor } from '../data/calendarColors';

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_STORAGE_KEY = 'dal-google-calendar-token';

const GoogleCalendarContext = createContext(null);

function createGoogleCalendarProvider() {
  const provider = new GoogleAuthProvider();
  provider.addScope(GOOGLE_CALENDAR_SCOPE);
  // access_type: 'offline' causes Google to issue a refresh_token so we can
  // silently re-authenticate after the 1-hour access_token expires.
  // prompt: 'consent' is required to guarantee the refresh_token is returned
  // on every connect (Google only sends it on the first authorisation otherwise).
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

/**
 * Extract the Google OAuth refresh token from the internal Firebase sign-in
 * response. This field is populated when access_type='offline' is requested.
 * It is NOT the Firebase refresh token – it is Google's own OAuth2 refresh
 * token that can be sent directly to oauth2.googleapis.com/token.
 */
function extractOAuthRefreshToken(result) {
  return result?._tokenResponse?.oauthRefreshToken || null;
}

/**
 * Build a token expiry ISO string. Google tokens live for 3600 s by default;
 * the _tokenResponse.oauthExpireIn field carries the actual value if present.
 */
function buildTokenExpiry(result) {
  const raw = result?._tokenResponse?.oauthExpireIn;
  const seconds = raw ? parseInt(raw, 10) : 3600;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function GoogleCalendarProvider({ children }) {
  const { relogin } = useAuth();
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'connectedCalendars'), (snapshot) => {
      const accounts = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.connectedAt || '').localeCompare(b.connectedAt || ''));
      setConnectedAccounts(accounts);
    });
    return () => unsub();
  }, []);

  const connectAccount = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      // Sign out first so Google re-prompts with calendar.readonly scope
      await signOut(auth);
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);

      const provider = createGoogleCalendarProvider();
      const result = await signInWithPopup(auth, provider);
      const token = extractOAuthAccessToken(result);
      const refreshToken = extractOAuthRefreshToken(result);
      const tokenExpiry = buildTokenExpiry(result);
      const email = result.user?.email;

      if (!token) {
        throw new Error('No OAuth access token received. Calendar scope may not have been granted.');
      }
      if (!email) {
        throw new Error('No email received from Google sign-in.');
      }

      const existing = connectedAccounts.find(a => a.email === email);
      const color = existing?.color ?? assignAccountColor(
        connectedAccounts.filter(a => a.email !== email).length
      );

      const record = {
        email,
        accessToken: token,
        tokenExpiry,
        color,
        needsReconnect: false,
        connectedAt: existing?.connectedAt || new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };

      // Only write refreshToken when Google actually returns one (it will on
      // every connect because we always pass prompt='consent').  We never
      // overwrite an existing refreshToken with null so that old records
      // retain whatever was previously stored.
      if (refreshToken) {
        record.refreshToken = refreshToken;
      }

      await setDoc(doc(db, 'connectedCalendars', email), record);

      await signOut(auth);
      await relogin();
    } catch (err) {
      setError(err.message || 'Failed to connect Google Calendar');
    } finally {
      setConnecting(false);
    }
  }, [connectedAccounts, relogin]);

  const disconnectAccount = useCallback(async (email) => {
    setError(null);
    await deleteDoc(doc(db, 'connectedCalendars', email));
  }, []);

  return (
    <GoogleCalendarContext.Provider
      value={{
        connectedAccounts,
        connecting,
        error,
        setError,
        connectAccount,
        disconnectAccount,
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

export {
  GOOGLE_CALENDAR_SCOPE,
  TOKEN_STORAGE_KEY,
  createGoogleCalendarProvider,
  extractOAuthAccessToken,
  extractOAuthRefreshToken,
  buildTokenExpiry,
};
