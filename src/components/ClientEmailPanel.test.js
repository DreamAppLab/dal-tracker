import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('firebase/firestore', () => {
  const fs = { contact: null, emails: [], updates: [] };
  global.mockFs = fs;
  return {
    doc: (_db, col, id) => ({ kind: 'doc', col, id }),
    collection: (_db, col) => ({ kind: 'col', col }),
    where: (f, op, v) => ({ f, op, v }),
    query: (col, w) => ({ kind: 'query', col: col.col, where: w }),
    updateDoc: (ref, data) => { fs.updates.push([ref.id, data]); return Promise.resolve(); },
    onSnapshot: (ref, cb) => {
      if (ref.kind === 'doc') {
        cb({ id: ref.id, exists: () => !!fs.contact, data: () => fs.contact });
      } else {
        cb({ docs: fs.emails.map((e) => ({ id: e.id, data: () => e })) });
      }
      return () => {};
    },
  };
});
jest.mock('../firebase', () => ({ db: {} }));
jest.mock('../lib/apiClient', () => ({ apiFetch: jest.fn() }));
jest.mock('./EmailBodyEditor', () => function MockEditor({ onChange }) {
  return <textarea aria-label="Message" onChange={(e) => onChange(e.target.value)} />;
});

// eslint-disable-next-line import/first
import { apiFetch } from '../lib/apiClient';
// eslint-disable-next-line import/first
import ClientEmailPanel from './ClientEmailPanel';

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  global.mockFs.contact = { name: 'Jaclyn Terrill', email: 'jaclyn@example.com' };
  global.mockFs.emails = [];
  global.mockFs.updates = [];
  apiFetch.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props) => act(() => { root.render(<ClientEmailPanel {...props} />); });
const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
function setValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

test('shows Compose for the assigned contact and the whole thread, marking replies read', () => {
  global.mockFs.emails = [
    { id: 'e2', direction: 'inbound', to: 'jaclyn@example.com', subject: 'Re: Website link', body: 'Looks great', read: false, source: 'contact', sentAt: '2026-11-17T19:57:55Z' },
    { id: 'e1', direction: 'outbound', to: 'jaclyn@example.com', subject: 'Website link', body: '<p>Here it is</p>', read: true, source: 'contact', sentAt: '2026-11-06T20:20:23Z' },
  ];
  render({ contactId: 'c1', projectId: 'wright-way' });
  expect(button('Compose')).toBeTruthy();
  expect(container.textContent).toContain('jaclyn@example.com');
  const text = container.textContent;
  expect(text.indexOf('Website link')).toBeLessThan(text.indexOf('Re: Website link')); // oldest first
  expect(text).toContain('via Contacts');
  expect(global.mockFs.updates).toEqual([['e2', { read: true }]]);
});

test('sends through the authenticated API as a web-project email', async () => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  render({ contactId: 'c1', projectId: 'wright-way' });
  act(() => button('Compose').click());
  const subject = container.querySelector('#cep-subject');
  act(() => setValue(subject, 'Draft is ready'));
  act(() => setValue(container.querySelector('textarea[aria-label="Message"]'), '<p>Take a look</p>'));
  await act(async () => { button('Send Email').click(); });
  expect(apiFetch).toHaveBeenCalledTimes(1);
  const [path, opts] = apiFetch.mock.calls[0];
  expect(path).toBe('/api/client-email');
  const fd = opts.body;
  expect(fd.get('to')).toBe('jaclyn@example.com');
  expect(fd.get('clientId')).toBe('c1');
  expect(fd.get('source')).toBe('webProject');
  expect(fd.get('projectId')).toBe('wright-way');
  expect(fd.get('subject')).toBe('Draft is ready');
  expect(container.textContent).toContain('lab@dreamapplab.com');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

test('send errors stay in the dialog', async () => {
  apiFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Email send failed' }) });
  render({ contactId: 'c1', projectId: 'wright-way' });
  act(() => button('Compose').click());
  act(() => setValue(container.querySelector('#cep-subject'), 'Hi'));
  act(() => setValue(container.querySelector('textarea[aria-label="Message"]'), 'x'));
  await act(async () => { button('Send Email').click(); });
  expect(container.querySelector('[role="alert"]').textContent).toBe('Email send failed');
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});

test('without a contact it offers to assign one instead of Compose', () => {
  const onEdit = jest.fn();
  render({ contactId: null, projectId: 'p', onEditProject: onEdit });
  expect(button('Compose')).toBeUndefined();
  act(() => button('Assign contact').click());
  expect(onEdit).toHaveBeenCalled();
});

test('a contact without an email address cannot be emailed', () => {
  global.mockFs.contact = { name: 'No Email' };
  render({ contactId: 'c2', projectId: 'p' });
  expect(button('Compose')).toBeUndefined();
  expect(container.textContent).toContain('has no email address');
});

test('replies are not marked read while the tab is hidden, then are when it becomes visible', () => {
  global.mockFs.emails = [{ id: 'e5', direction: 'inbound', parentId: 'o1', to: 'j@example.com', subject: 'Re', body: 'hi', read: false, source: 'webProject', sentAt: '2026-11-20T10:00:00Z' }];
  const vis = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  render({ contactId: 'c1', projectId: 'p' });
  expect(global.mockFs.updates).toEqual([]);
  vis.mockReturnValue('visible');
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(global.mockFs.updates).toEqual([['e5', { read: true }]]);
  vis.mockRestore();
});

test('inbound email content is shown as text, never as HTML', () => {
  global.mockFs.emails = [{ id: 'x1', direction: 'inbound', to: 'j@example.com', subject: 'Hi', body: '<img src=x onerror=alert(1)><script>bad()</script>', read: true, source: 'contact', sentAt: '2026-11-20T10:00:00Z' }];
  render({ contactId: 'c1', projectId: 'p' });
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(container.textContent).toContain('<script>bad()</script>');
  expect(container.textContent).toContain('From j@example.com'); // not a reply
});

test('Escape closes the compose dialog', () => {
  render({ contactId: 'c1', projectId: 'p' });
  act(() => button('Compose').click());
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
