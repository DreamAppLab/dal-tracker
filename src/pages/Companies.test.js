import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const DAL_EIN = '98-7654321';
const ZERBIQ_EIN = '11-2223333';
const CARD = '4111111111111111';

// Controllable Firestore: snapshots are delivered on subscribe unless held,
// and tests can re-deliver them with mockFs.emit().
jest.mock('firebase/firestore', () => {
  const listeners = new Map();
  const keyOf = (ref) => (ref.kind === 'doc' ? `${ref.col}/${ref.id}` : `${ref.col}/${ref.id}/${ref.sub}`);
  const fs = {
    data: {},
    hold: new Set(),
    emit(key) {
      const v = fs.data[key];
      (listeners.get(key) || new Set()).forEach((cb) =>
        cb(Array.isArray(v) ? { docs: v.map((d) => ({ id: d.id, data: () => d })) } : { exists: () => !!v, data: () => v })
      );
    },
  };
  global.mockFs = fs;
  return {
    doc: (_db, col, id) => ({ kind: 'doc', col, id }),
    collection: (_db, col, id, sub) => ({ kind: 'col', col, id, sub }),
    onSnapshot: (ref, cb) => {
      const key = keyOf(ref);
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(cb);
      if (!fs.hold.has(key)) fs.emit(key);
      return () => listeners.get(key).delete(cb);
    },
  };
});
jest.mock('../firebase', () => ({ db: {} }));
jest.mock('../lib/apiClient', () => ({ apiJson: jest.fn() }));
jest.mock('../contexts/ReauthContext', () => {
  const state = { isConfirming: false, pending: false };
  global.mockReauth = state;
  return {
    useRecentAuth: () => ({
      requireRecentAuth: () => (state.pending ? new Promise(() => {}) : Promise.resolve()),
      isConfirming: state.isConfirming,
    }),
  };
});

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
let revealGate; // when set, reveal responses wait for it

beforeEach(() => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(global.mockReauth, { isConfirming: false, pending: false });
  global.mockFs.hold.clear();
  global.mockFs.data = {
    'companies/dal': { legalName: 'Dream App Lab LLC', phone: '(904) 385-0060', masked: { ein: '••-•••4321', documentNumber: null } },
    'companies/zerbiq': { legalName: 'Zerbiq', masked: { ein: '••-•••3333', documentNumber: null } },
    'companies/dal/creditCards': [{ id: 'c1', nickname: 'Ink', issuer: 'Chase', cardholder: 'Eddie', expiry: '01/30', masked: { cardNumber: '•••• 1111' }, last4: '1111' }],
    'companies/dal/bankAccounts': [{ id: 'b1', nickname: 'Operating', bankName: 'Chase', accountType: 'Checking', masked: { routingNumber: '•••• 0021', accountNumber: '•••• 6789' }, last4: '6789' }],
    'companies/zerbiq/creditCards': [],
    'companies/zerbiq/bankAccounts': [],
  };
  clipboard = { text: '', focused: true };
  clipboard.writeText = jest.fn(async (t) => {
    if (!clipboard.focused) throw new Error('Document is not focused.');
    clipboard.text = t;
  });
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  revealGate = null;
  apiJson.mockReset();
  apiJson.mockImplementation(async (url, opts) => {
    if (url === '/api/vault/ensure-companies') return { ok: true, created: [] };
    if (url === '/api/vault/reveal') {
      if (revealGate) await revealGate;
      const { path, field } = opts.body;
      return { ok: true, value: VALUES[`${path}|${field}`], hideAfterSeconds: 30 };
    }
    if (url === '/api/vault/company') return { ok: true };
    throw new Error(`unexpected ${url}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  // Let any pending clipboard clear finish so module state doesn't leak between tests.
  clipboard.focused = true;
  await act(async () => { jest.advanceTimersByTime(60_000); });
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  jest.useRealTimers();
});

const render = async () => {
  await act(async () => root.render(<Companies />));
};
const btn = (label) => container.querySelector(`button[aria-label="${label}"]`);
const byText = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent === text);
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const key = async (k, opts = {}) => {
  await act(async () => {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
  });
};
const tab = (name) => [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === name);
const revealCalls = () => apiJson.mock.calls.filter(([u]) => u === '/api/vault/reveal');
const setVisibility = async (v) => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
};
const typeInto = async (input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const inputFor = (dialog, labelText) => document.getElementById([...dialog.querySelectorAll('label')].find((l) => l.textContent === labelText).htmlFor);

// ── Masking / reveal ────────────────────────────────────────────────────────
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
  await click(btn('Reveal card number for Ink'));
  expect(container.textContent).toContain(CARD);
  expect(btn('Hide card number for Ink').textContent).toBe('Hide · 30s');
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(btn('Hide card number for Ink').textContent).toBe('Hide · 20s');
  await act(async () => { jest.advanceTimersByTime(20_000); });
  expect(container.textContent).not.toContain(CARD);
  expect(container.textContent).toContain('•••• 1111');
});

test('a revealed value hides when the tab is hidden', async () => {
  await render();
  await click(btn('Reveal EIN'));
  expect(container.textContent).toContain(DAL_EIN);
  await setVisibility('hidden');
  expect(container.textContent).not.toContain(DAL_EIN);
  await setVisibility('visible');
});

test('a reveal still in flight when the tab is hidden never shows the value', async () => {
  await render();
  let open;
  revealGate = new Promise((r) => { open = r; });
  await click(btn('Reveal EIN'));
  await setVisibility('hidden');
  await act(async () => { open(); });
  await setVisibility('visible');
  expect(container.textContent).not.toContain(DAL_EIN);
  expect(btn('Reveal EIN').disabled).toBe(false);
});

test('a revealed value hides when the saved value changes', async () => {
  await render();
  await click(btn('Reveal EIN'));
  expect(container.textContent).toContain(DAL_EIN);
  global.mockFs.data['companies/dal'] = { ...global.mockFs.data['companies/dal'], masked: { ein: '••-•••9999', documentNumber: null } };
  await act(async () => { global.mockFs.emit('companies/dal'); });
  expect(container.textContent).not.toContain(DAL_EIN);
  expect(container.textContent).toContain('••-•••9999');
});

// ── Switching company ─────────────────────────────────────────────────────────
test('a revealed EIN never carries over when switching company', async () => {
  await render();
  await click(btn('Reveal EIN'));
  expect(container.textContent).toContain(DAL_EIN);
  await click(tab('Zerbiq'));
  expect(container.textContent).not.toContain(DAL_EIN);
  expect(container.textContent).toContain('••-•••3333');
  await click(tab('Dream App Lab LLC'));
  expect(container.textContent).not.toContain(DAL_EIN);
  expect(container.textContent).toContain('••-•••4321');
});

test("the other company's accounts and cards are never shown while a company loads", async () => {
  await render();
  expect(container.textContent).toContain('Operating');
  global.mockFs.hold.add('companies/zerbiq/bankAccounts');
  global.mockFs.hold.add('companies/zerbiq/creditCards');
  await click(tab('Zerbiq'));
  expect(container.textContent).not.toContain('Operating');
  expect(container.textContent).not.toContain('Ink');
  expect(container.textContent).toContain('Loading…');
  await act(async () => {
    global.mockFs.emit('companies/zerbiq/bankAccounts');
    global.mockFs.emit('companies/zerbiq/creditCards');
  });
  expect(container.textContent).toContain('No bank accounts yet.');
});

// ── Clipboard ───────────────────────────────────────────────────────────────
test('copy puts the value on the clipboard and clears it after 30 seconds', async () => {
  await render();
  await click(btn('Copy card number for Ink'));
  expect(clipboard.text).toBe(CARD);
  expect(container.textContent).toContain('Copied · clipboard clears in 30s');
  expect(container.textContent).not.toContain(CARD); // copying does not reveal
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(clipboard.text).toBe('');
});

test('if the tab is in the background at 30 s, it clears on return and offers a button meanwhile', async () => {
  await render();
  await click(btn('Copy EIN'));
  clipboard.focused = false;
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(clipboard.text).toBe(DAL_EIN);
  expect(container.textContent).toContain('A copied number is still on your clipboard.');
  clipboard.focused = true;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(clipboard.text).toBe('');
  expect(container.textContent).not.toContain('still on your clipboard');
});

test('"Clear clipboard now" clears it immediately', async () => {
  await render();
  await click(btn('Copy EIN'));
  clipboard.focused = false;
  await act(async () => { jest.advanceTimersByTime(30_000); });
  clipboard.focused = true; // the click focuses the page
  await click(byText('Clear clipboard now'));
  expect(clipboard.text).toBe('');
  expect(container.textContent).not.toContain('still on your clipboard');
});

test("a newer copy is not wiped by the older copy's timer", async () => {
  await render();
  await click(btn('Copy EIN'));
  await act(async () => { jest.advanceTimersByTime(20_000); });
  await click(btn('Copy card number for Ink'));
  await act(async () => { jest.advanceTimersByTime(15_000); });
  expect(clipboard.text).toBe(CARD); // 35 s after the first copy, 15 s after the second
  await act(async () => { jest.advanceTimersByTime(15_000); });
  expect(clipboard.text).toBe('');
});

// ── Modals ──────────────────────────────────────────────────────────────────
const openCompanyForm = async () => {
  await render();
  await click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Edit'));
  return document.querySelector('[role="dialog"]');
};

test('edit modal: focus starts on the first field, labels are tied to inputs, Tab stays inside', async () => {
  const dialog = await openCompanyForm();
  expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  const first = dialog.querySelector('.modal-body input');
  expect(document.activeElement).toBe(first);
  expect(dialog.querySelector(`label[for="${first.id}"]`).textContent).toBe('Legal name');
  const save = byText('Save');
  save.focus();
  await key('Tab');
  expect(document.activeElement).toBe(dialog.querySelector('button[aria-label="Close"]'));
  await key('Tab', { shiftKey: true });
  expect(document.activeElement).toBe(save);
});

test('edit modal: backdrop click does not close it; Escape does', async () => {
  const dialog = await openCompanyForm();
  await act(async () => { dialog.parentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  await act(async () => { dialog.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await key('Escape');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test('edit modal cannot be dismissed while a save is waiting to confirm identity', async () => {
  const dialog = await openCompanyForm();
  await typeInto(inputFor(dialog, 'Phone'), '(904) 555-0199');
  global.mockReauth.pending = true;
  await click(byText('Save'));
  expect(byText('Saving…')).toBeTruthy();
  await key('Escape');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(dialog.querySelector('button[aria-label="Close"]').disabled).toBe(true);
  expect(byText('Cancel').disabled).toBe(true);
});

test('edit modal ignores Escape and Tab while "Confirm it\'s you" is open', async () => {
  const dialog = await openCompanyForm();
  global.mockReauth.isConfirming = true;
  await act(async () => root.render(<Companies />));
  const save = byText('Save');
  save.focus();
  await key('Tab'); // not wrapped by the edit modal
  expect(document.activeElement).toBe(save);
  await key('Escape');
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
});

test('company save sends only the fields that changed', async () => {
  const dialog = await openCompanyForm();
  await typeInto(inputFor(dialog, 'Phone'), '(904) 555-0199');
  await click(byText('Save'));
  const [, opts] = apiJson.mock.calls.find(([u]) => u === '/api/vault/company');
  expect(opts.body).toEqual({ companyId: 'dal', phone: '(904) 555-0199' });
});

test('sensitive inputs have spellcheck and autofill off', async () => {
  const dialog = await openCompanyForm();
  const ein = inputFor(dialog, 'EIN');
  expect(ein.getAttribute('spellcheck')).toBe('false');
  expect(ein.getAttribute('autocomplete')).toBe('off');
});

test("an edit made in another tab while the modal is open is not reverted", async () => {
  const dialog = await openCompanyForm();
  // Another tab changes the phone while this form is open.
  global.mockFs.data['companies/dal'] = { ...global.mockFs.data['companies/dal'], phone: '(904) 555-7777' };
  await act(async () => { global.mockFs.emit('companies/dal'); });
  await typeInto(inputFor(dialog, 'DBA'), 'DAL');
  await click(byText('Save'));
  const [, opts] = apiJson.mock.calls.find(([u]) => u === '/api/vault/company');
  expect(opts.body).toEqual({ companyId: 'dal', dba: 'DAL' });
});

test('a copy still in flight when switching company is dropped', async () => {
  await render();
  let open;
  revealGate = new Promise((r) => { open = r; });
  await click(btn('Copy EIN'));
  await click(tab('Zerbiq'));
  await act(async () => { open(); });
  expect(clipboard.text).toBe('');
  expect(clipboard.writeText).not.toHaveBeenCalled();
});

test('bank/card counts are hidden while lists load', async () => {
  await render();
  global.mockFs.hold.add('companies/zerbiq/bankAccounts');
  global.mockFs.hold.add('companies/zerbiq/creditCards');
  await click(tab('Zerbiq'));
  expect(container.querySelectorAll('.vault-count')).toHaveLength(0);
});
