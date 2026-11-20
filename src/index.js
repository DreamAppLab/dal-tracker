// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ReauthProvider } from './contexts/ReauthContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <ReauthProvider>
        <App />
      </ReauthProvider>
    </AuthProvider>
  </React.StrictMode>
);
