import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth, db } from '../firebase';
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

export function GoogleCalendarProvider({ children }) {
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

      await setDoc(doc(db, 'connectedCalendars', email), {
        email,
        accessToken: token,
        color,
        connectedAt: existing?.connectedAt || new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      });

      await signOut(auth);
    } catch (err) {
      setError(err.message || 'Failed to connect Google Calendar');
    } finally {
      setConnecting(false);
    }
  }, [connectedAccounts]);

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

export { GOOGLE_CALENDAR_SCOPE, TOKEN_STORAGE_KEY, createGoogleCalendarProvider, extractOAuthAccessToken };
