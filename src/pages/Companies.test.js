import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const DAL_EIN = '98-7654321';
const ZERBIQ_EIN = '11-2223333';
const CARD = '4111111111111111';

jest.mock('../firebase', () => ({ db: {} }));

jest.mock('firebase/firestore', () => {
  const companies = {
    dal: { legalName: 'Dream App Lab LLC', masked: { ein: '••-•••4321', documentNumber: null } },
    zerbiq: { legalName: 'Zerbiq', masked: { ein: '••-•••3333', documentNumber: null } },
  };
  const cards = { dal: [{ id: 'c1', nickname: 'Ink', issuer: 'Chase', cardholder: 'Eddie', expiry: '01/30', masked: { cardNumber: '•••• 1111' }, last4: '1111' }], zerbiq: [] };
  return {
    doc: (_db, col, id) => ({ kind: 'doc', col, id }),
    collection: (_db, col, id, sub) => ({ kind: 'col', col, id, sub }),
    onSnapshot: (ref, cb) => {
      if (ref.kind === 'doc') cb({ exists: () => true, data: () => companies[ref.id] });
      else cb({ docs: (ref.sub === 'creditCards' ? cards[ref.id] : []).map((d) => ({ id: d.id, data: () => d })) });
      return () => {};
    },
  };
});

jest.mock('../lib/apiClient', () => ({ apiJson: jest.fn() }));
jest.mock('../contexts/ReauthContext', () => ({
  useRecentAuth: () => ({ requireRecentAuth: async () => {}, isConfirming: false }),
}));

// eslint-disable-next-line import/first
import { apiJson } from '../lib/apiClient';
// eslint-disable-next-line import/first
import Companies from './Companies';

const VALUES = {
  'companies/dal|ein': DAL_EIN,
  'companies/zerbiq|ein': ZERBIQ_EIN,
  'companies/dal/creditCards/c1|cardNumber': CARD,
};

let container;
let root;
let clipboard;

beforeEach(() => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  clipboard = { text: '', writeText: jest.fn(async (t) => { clipboard.text = t; }) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  apiJson.mockReset();
  apiJson.mockImplementation(async (url, opts) => {
    if (url === '/api/vault/ensure-companies') return { ok: true, created: [] };
    if (url === '/api/vault/reveal') {
      const { path, field } = opts.body;
      return { ok: true, value: VALUES[`${path}|${field}`], hideAfterSeconds: 30 };
    }
    throw new Error(`unexpected ${url}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

const render = async () => {
  await act(async () => root.render(<Companies />));
};
const button = (label) => container.querySelector(`button[aria-label="${label}"]`);
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};
const revealCalls = () => apiJson.mock.calls.filter(([u]) => u === '/api/vault/reveal');

test('shows masked values only, without asking the server for any secret', async () => {
  await render();
  expect(container.textContent).toContain('••-•••4321');
  expect(container.textContent).toContain('•••• 1111');
  expect(container.textContent).not.toContain(DAL_EIN);
  expect(container.textContent).not.toContain(CARD);
  expect(revealCalls()).toHaveLength(0);
  expect(container.textContent).toContain('Not saved'); // document number
});

test('a revealed value auto-hides after 30 seconds', async () => {
  await render();
  await click(button('Reveal card number'));
  expect(container.textContent).toContain(CARD);
  expect(button('Hide card number').textContent).toBe('Hide · 30s');
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(button('Hide card number').textContent).toBe('Hide · 20s');
  await act(async () => { jest.advanceTimersByTime(20_000); });
  expect(container.textContent).not.toContain(CARD);
  expect(container.textContent).toContain('•••• 1111');
});

test('a revealed value hides when the tab is hidden', async () => {
  await render();
  await click(button('Reveal EIN'));
  expect(container.textContent).toContain(DAL_EIN);
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(container.textContent).not.toContain(DAL_EIN);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

test('a revealed EIN never carries over when switching company', async () => {
  await render();
  await click(button('Reveal EIN'));
  expect(container.textContent).toContain(DAL_EIN);
  const zerbiqTab = [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Zerbiq');
  await click(zerbiqTab);
  expect(container.textContent).not.toContain(DAL_EIN);
  expect(container.textContent).toContain('••-•••3333');
  // Switching back shows the masked value, not the earlier plaintext.
  const dalTab = [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Dream App Lab LLC');
  await click(dalTab);
  expect(container.textContent).not.toContain(DAL_EIN);
  expect(container.textContent).toContain('••-•••4321');
});

test('copy puts the value on the clipboard and clears it after 30 seconds', async () => {
  await render();
  await click(button('Copy card number'));
  expect(clipboard.text).toBe(CARD);
  expect(container.textContent).toContain('Copied · clears in 30s');
  expect(container.textContent).not.toContain(CARD); // copying does not reveal
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(clipboard.text).toBe('');
});

test('copy clear still happens after leaving the page', async () => {
  await render();
  await click(button('Copy EIN'));
  expect(clipboard.text).toBe(DAL_EIN);
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(clipboard.text).toBe('');
});
