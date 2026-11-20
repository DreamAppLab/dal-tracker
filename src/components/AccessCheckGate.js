import React, { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { sendEmailVerification } from 'firebase/auth';
import { useAuth } from '../contexts/AuthContext';

// Verifies, once per sign-in, that the signed-in account can actually read
// Firestore before the app renders. Firestore security rules are the single
// source of truth for who is allowed in — this gate just asks them.
//
// Without this, an account the rules don't recognise (for example a Google
// sign-in that created a second Firebase user) gets the full app shell with
// every tab failing on "Missing or insufficient permissions" and the dashboard
// quietly showing zeros.
const PROBE_DOC = ['dashboard', 'summary'];

export default function AccessCheckGate({ children }) {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState('checking'); // checking | ok | denied | error
  const [errorMessage, setErrorMessage] = useState('');
  const [verifyState, setVerifyState] = useState('idle'); // idle | sending | sent | error

  const runCheck = useCallback(async () => {
    setStatus('checking');
    setErrorMessage('');
    try {
      // Pick up a just-completed email verification before asking the rules.
      if (user && !user.emailVerified) {
        await user.reload().catch(() => {});
        await user.getIdToken(true).catch(() => {});
      }
      await getDoc(doc(db, ...PROBE_DOC));
      setStatus('ok');
    } catch (err) {
      if (err?.code === 'permission-denied') {
        setStatus('denied');
      } else {
        setStatus('error');
        setErrorMessage(err?.message || 'Unknown error');
      }
    }
  }, [user]);

  const sendVerification = useCallback(async () => {
    if (!user) return;
    setVerifyState('sending');
    try {
      await sendEmailVerification(user);
      setVerifyState('sent');
    } catch {
      setVerifyState('error');
    }
  }, [user]);

  useEffect(() => {
    runCheck();
  }, [runCheck, user?.uid]);

  useEffect(() => {
    if (status === 'ok') return undefined;
    document.body.classList.add('login-page-active');
    return () => document.body.classList.remove('login-page-active');
  }, [status]);

  if (status === 'ok') return children;

  if (status === 'checking') {
    return (
      <div className="auth-status-screen">
        <p className="auth-status-message">Checking access…</p>
      </div>
    );
  }

  const providers = (user?.providerData || [])
    .map((p) => (p.providerId === 'google.com' ? 'Google' : p.providerId === 'password' ? 'Email & password' : p.providerId))
    .join(', ') || 'Unknown';

  return (
    <div className="auth-status-screen">
      <div className="access-check-card">
        <h2 className="access-check-title">
          {status === 'denied' ? 'This account can’t open Mission Control' : 'Couldn’t reach the database'}
        </h2>
        <p className="auth-status-message">
          {status === 'denied'
            ? 'You are signed in, but this account is not on Mission Control’s allowlist, or its email address is not verified, so no data can load.'
            : `Mission Control couldn’t confirm access: ${errorMessage}`}
        </p>
        {status === 'denied' && user && !user.emailVerified && (
          <div className="access-check-verify">
            <p className="auth-status-message">
              This sign-in’s email address ({user.email}) has not been verified. Verify it, then press “Try again”.
              Signing in with Google verifies it automatically.
            </p>
            <button type="button" className="login-btn" onClick={sendVerification} disabled={verifyState === 'sending' || verifyState === 'sent'}>
              {verifyState === 'sent' ? 'Verification email sent — check your inbox' : verifyState === 'sending' ? 'Sending…' : 'Send verification email'}
            </button>
            {verifyState === 'error' && <p className="login-error">Could not send the email. Try again in a minute.</p>}
          </div>
        )}
        <dl className="access-check-details">
          <dt>Signed in as</dt>
          <dd>{user?.email || '(no email)'}</dd>
          <dt>Sign-in method</dt>
          <dd>{providers}</dd>
          <dt>Email verified</dt>
          <dd>{user?.emailVerified ? 'Yes' : 'No'}</dd>
          <dt>Account ID</dt>
          <dd className="access-check-uid">{user?.uid}</dd>
        </dl>
        <div className="access-check-actions">
          <button type="button" className="login-btn" onClick={runCheck}>
            Try again
          </button>
          <button type="button" className="login-btn login-btn-secondary" onClick={logout}>
            Sign out and use another account
          </button>
        </div>
      </div>
    </div>
  );
}
