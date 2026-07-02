import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function AuthLoadingScreen() {
  const { authError, authTimedOut, retryAuth } = useAuth();

  if (authError || authTimedOut) {
    return (
      <div className="auth-status-screen">
        <p className="auth-status-message">
          {authTimedOut
            ? 'Authentication is taking longer than expected.'
            : 'Unable to verify your sign-in status.'}
        </p>
        <button type="button" className="login-btn" onClick={retryAuth}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="auth-status-screen">
      <p className="auth-status-message">Loading...</p>
    </div>
  );
}
