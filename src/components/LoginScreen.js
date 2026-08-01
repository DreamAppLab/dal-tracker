import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';

export default function LoginScreen() {
  const { login } = useAuth();
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
      const userCredential = await login(email.trim(), password);

      const { doc, setDoc } = await import('firebase/firestore');
      setDoc(doc(db, 'loginEvents', Date.now().toString()), {
        email: userCredential.user.email,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
      }).catch(e => console.warn('Login event failed:', e));

      const brevoKey = process.env.REACT_APP_BREVO_API_KEY;
      if (brevoKey) {
        fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': brevoKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: 'DAL Mission Control', email: 'lab@dreamapplab.com' },
            to: [{ email: 'lab@dreamapplab.com', name: 'Eddie Skehan' }],
            subject: `Mission Control Login — ${new Date().toLocaleString()}`,
            htmlContent: `<p>Mission Control was accessed at ${new Date().toLocaleString()}.</p><p>If this was not you, change your password immediately at <a href="https://dal-tracker.vercel.app">dal-tracker.vercel.app</a></p>`,
          }),
        }).catch(e => console.warn('Brevo notification failed:', e));
      }
    } catch (err) {
      setError(err.message || 'Login failed. Check your email and password.');
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
        </div>
      </div>
    </div>
  );
}
