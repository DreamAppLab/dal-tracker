import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('firebase/auth', () => {
  class GoogleAuthProvider {
    setCustomParameters(p) { this.params = p; }
  }
  return {
    EmailAuthProvider: { credential: jest.fn() },
    GoogleAuthProvider,
    reauthenticateWithPopup: jest.fn(),
    reauthenticateWithCredential: jest.fn(),
  };
});
jest.mock('../firebase', () => ({
  auth: {
    currentUser: {
      email: 'lab@dreamapplab.com',
      providerData: [{ providerId: 'google.com' }],
      getIdTokenResult: async () => ({ claims: { auth_time: 0 } }),
      getIdToken: async () => 'tok',
    },
  },
}));
jest.mock('../lib/apiClient', () => ({ setReauthHandler: jest.fn() }));
jest.mock('./AuthContext', () => ({ markActivity: jest.fn() }));

// eslint-disable-next-line import/first
import { ReauthProvider, useRecentAuth } from './ReauthContext';
// eslint-disable-next-line import/first
import { reauthenticateWithPopup } from 'firebase/auth';

let container;
let root;
let api;
function Probe() {
  api = useRecentAuth();
  return <button type="button" id="opener">Open</button>;
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const key = async (k, opts = {}) => {
  await act(async () => {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
  });
};

test('dialog takes focus, traps Tab, Escape cancels only it, and focus is restored', async () => {
  await act(async () => root.render(<ReauthProvider><Probe /></ReauthProvider>));
  const opener = document.getElementById('opener');
  opener.focus();
  const outerEscape = jest.fn();
  window.addEventListener('keydown', outerEscape); // a form modal underneath
  let result;
  await act(async () => {
    result = api.requireRecentAuth(300).then(() => 'ok', (e) => e.code);
  });
  const card = document.querySelector('.reauth-card');
  expect(card).not.toBeNull();
  expect(api.isConfirming).toBe(true);
  expect(document.activeElement.textContent).toBe('Continue with Google');
  const buttons = [...card.querySelectorAll('button')];
  buttons[buttons.length - 1].focus();
  await key('Tab');
  expect(document.activeElement).toBe(buttons[0]);
  opener.focus(); // focus escaped somehow: Tab pulls it back in
  await key('Tab');
  expect(card.contains(document.activeElement)).toBe(true);
  expect(outerEscape).not.toHaveBeenCalled();
  await key('Escape');
  expect(outerEscape).not.toHaveBeenCalled();
  expect(await result).toBe('reauth-cancelled');
  expect(document.querySelector('.reauth-card')).toBeNull();
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)); });
  expect(document.activeElement).toBe(opener);
  window.removeEventListener('keydown', outerEscape);
});

test('Continue with Google asks for the account chooser and explains a wrong account', async () => {
  await act(async () => root.render(<ReauthProvider><Probe /></ReauthProvider>));
  await act(async () => { api.requireRecentAuth(300).catch(() => {}); });
  reauthenticateWithPopup.mockRejectedValueOnce(Object.assign(new Error('mismatch'), { code: 'auth/user-mismatch' }));
  const google = [...document.querySelectorAll('.reauth-card button')].find((b) => b.textContent === 'Continue with Google');
  await act(async () => { google.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(reauthenticateWithPopup.mock.calls[0][1].params).toEqual({ prompt: 'select_account', login_hint: 'lab@dreamapplab.com', hd: 'dreamapplab.com' });
  expect(document.querySelector('.reauth-card').textContent).toContain('Use the same Google account you are signed in with.');
  await act(async () => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
});
