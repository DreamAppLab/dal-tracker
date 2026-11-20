import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('firebase/auth', () => {
  class GoogleAuthProvider {
    setCustomParameters(p) { this.params = p; }
  }
  return { GoogleAuthProvider, signInWithPopup: jest.fn(async () => ({})) };
});
jest.mock('../firebase', () => ({ auth: {} }));
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login: jest.fn(), signOutReason: null, setSignOutReason: jest.fn() }),
  markActivity: jest.fn(),
}));

// eslint-disable-next-line import/first
import { signInWithPopup } from 'firebase/auth';
// eslint-disable-next-line import/first
import LoginScreen from './LoginScreen';

let container;
let root;
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

test('Google sign-in always shows the account chooser, pointed at the Dream App Lab account', async () => {
  await act(async () => root.render(<LoginScreen />));
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Sign in with Google');
  await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(signInWithPopup).toHaveBeenCalledTimes(1);
  const provider = signInWithPopup.mock.calls[0][1];
  expect(provider.params).toEqual({ prompt: 'select_account', login_hint: 'lab@dreamapplab.com', hd: 'dreamapplab.com' });
});

test('Google sign-in comes first, with the account to use named', async () => {
  await act(async () => root.render(<LoginScreen />));
  const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent);
  expect(buttons[0]).toBe('Sign in with Google');
  expect(container.textContent).toContain('Use your lab@dreamapplab.com Google account.');
});
