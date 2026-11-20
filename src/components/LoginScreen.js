import React, { useState, useEffect } from 'react';
import { useAuth, markActivity } from '../contexts/AuthContext';
import { auth } from '../firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

export default function LoginScreen() {
  const { login, signOutReason, setSignOutReason } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.body.classList.add('login-page-active');
    return () => document.body.classList.remove('login-page-active');
  }, []);
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // Sign-in is recorded server-side (auditLog + alert email) by AuthContext.
      await login(email.trim(), password);
    } catch (err) {
      setError('Sign-in failed. Check your email and password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-layout">
        <header className="login-brand">
          <img
            src={`${process.env.PUBLIC_URL}/dream-app-lab-logo.png`}
            alt="Dream App Lab"
            className="login-brand-logo"
          />
          <h1 className="login-brand-title">Mission Control</h1>
        </header>

        <div className="login-card">
          <p className="login-subtitle">Sign in to access the dashboard</p>
          {signOutReason === 'idle' && (
            <p className="login-notice" role="status">
              You were signed out after 30 minutes of inactivity.
            </p>
          )}
          <form className="login-form" onSubmit={handleSubmit}>
            <label className="login-label">
              Email
              <input
                type="email"
                className="login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="login-label">
              Password
              <input
                type="password"
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="login-btn" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <button
            className="login-btn login-btn-google"
            type="button"
            onClick={async () => {
              setError('');
              setSignOutReason(null);
              markActivity();
              try {
                await signInWithPopup(auth, new GoogleAuthProvider());
              } catch (err) {
                const code = err && err.code;
                if (code === 'auth/popup-blocked') setError('The sign-in window was blocked. Allow pop-ups for this site and try again.');
                else if (code === 'auth/admin-restricted-operation') setError('This Google account is not allowed. Sign in with lab@dreamapplab.com.');
                else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setError('Google sign-in failed. Try again.');
              }
            }}
          >
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
}
