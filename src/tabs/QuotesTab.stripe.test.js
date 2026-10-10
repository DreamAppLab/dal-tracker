import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { QuoteDetail } from './QuotesTab';

jest.mock('../firebase', () => ({ db: {} }));
jest.mock('../firebaseZerbiq', () => ({ zerbiqDb: null, zerbiqStorage: null }));
jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  collection: jest.fn(),
  doc: jest.fn(),
  getDocs: jest.fn(),
  onSnapshot: jest.fn(),
  query: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  where: jest.fn(),
}));
jest.mock('firebase/storage', () => ({
  getDownloadURL: jest.fn(),
  listAll: jest.fn(),
  ref: jest.fn(),
}));

function quoteFixture(overrides = {}) {
  return {
    id: 'q1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    status: 'accepted',
    readAt: '2026-01-01T00:00:00.000Z',
    total: 1000,
    createdAt: new Date().toISOString(),
    business: 'Analytical Engines',
    ...overrides,
  };
}

function renderDetail(initial) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function Harness() {
    const [quote, setQuote] = useState(initial);
    return (
      <QuoteDetail
        quote={quote}
        onBack={() => {}}
        onQuotePatched={(id, updated) => {
          setQuote((prev) => ({ ...prev, ...updated, id }));
        }}
      />
    );
  }
  act(() => {
    root.render(<Harness />);
  });
  return {
    container,
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function clickButton(container, name) {
  const button = Array.from(container.querySelectorAll('button')).find((el) => el.textContent.trim() === name);
  if (!button) throw new Error('Missing button: ' + name);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return button;
}

function setInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  global.fetch = jest.fn(async (url, options) => {
    const href = String(url);
    if (href.includes('/api/quotes/messages')) {
      return { ok: true, json: async () => ({ ok: true, messages: [] }) };
    }
    if (href.includes('/api/quote-payment-link')) {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ ok: true, url: body.paymentUrl || 'https://buy.stripe.com/generated' }),
      };
    }
    if (href.includes('/api/quotes')) {
      const body = options && options.body ? JSON.parse(options.body) : {};
      return { ok: true, json: async () => ({ ok: true, quote: { id: 'q1', ...body } }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  });
});

test('empty stripe link shows an input and Save', async () => {
  const view = renderDetail(quoteFixture());
  await flush();
  const input = view.container.querySelector('input[placeholder="Paste Stripe payment link..."]');
  expect(input).toBeTruthy();
  expect(Array.from(view.container.querySelectorAll('button')).some((el) => el.textContent.trim() === 'Save')).toBe(true);
  expect(view.container.textContent).not.toContain('Open Payment Link');
  view.cleanup();
});

test('saved stripe link opens in a new tab and can be changed', async () => {
  const view = renderDetail(quoteFixture({ stripePaymentLink: 'https://buy.stripe.com/test_abc' }));
  await flush();
  const link = Array.from(view.container.querySelectorAll('a')).find((el) => el.textContent.includes('Open Payment Link'));
  expect(link.getAttribute('href')).toBe('https://buy.stripe.com/test_abc');
  expect(link.getAttribute('target')).toBe('_blank');
  clickButton(view.container, 'Change');
  const input = view.container.querySelector('input[placeholder="Paste Stripe payment link..."]');
  expect(input.value).toBe('https://buy.stripe.com/test_abc');
  view.cleanup();
});

test('saving writes stripePaymentLink', async () => {
  const view = renderDetail(quoteFixture());
  await flush();
  setInput(view.container.querySelector('input[placeholder="Paste Stripe payment link..."]'), 'https://buy.stripe.com/saved');
  clickButton(view.container, 'Save');
  await flush();
  await flush();
  const link = Array.from(view.container.querySelectorAll('a')).find((el) => el.textContent.includes('Open Payment Link'));
  expect(link).toBeTruthy();
  expect(link.getAttribute('href')).toBe('https://buy.stripe.com/saved');
  const saveCall = global.fetch.mock.calls.find(
    ([url, options]) => String(url).includes('/api/quotes?id=') && options && options.method === 'POST'
  );
  expect(JSON.parse(saveCall[1].body)).toEqual({ stripePaymentLink: 'https://buy.stripe.com/saved' });
  view.cleanup();
});

test('monthly plans require a saved link before sending', async () => {
  const view = renderDetail(
    quoteFixture({
      paymentPlan: 'monthly',
      monthlyAmount: 250,
      monthlyPayments: 4,
    })
  );
  await flush();
  clickButton(view.container, 'Send Payment Link');
  expect(view.container.textContent).toContain('Please add a Stripe payment link before sending');
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/api/quote-payment-link'))).toBe(false);
  view.cleanup();
});

test('monthly send uses the saved Stripe payment link', async () => {
  const view = renderDetail(
    quoteFixture({
      paymentPlan: 'monthly',
      monthlyAmount: 250,
      monthlyPayments: 4,
      stripePaymentLink: 'https://buy.stripe.com/monthly',
    })
  );
  await flush();
  expect(view.container.textContent).not.toContain('Send Deposit Link');
  clickButton(view.container, 'Send Payment Link');
  expect(view.container.textContent).toContain('Send payment link of');
  clickButton(view.container, 'Confirm');
  await flush();
  await flush();
  const sendCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/api/quote-payment-link'));
  expect(sendCall).toBeTruthy();
  expect(JSON.parse(sendCall[1].body).paymentUrl).toBe('https://buy.stripe.com/monthly');
  view.cleanup();
});

test('standard plans keep Send Deposit Link', async () => {
  const view = renderDetail(quoteFixture({ paymentPlan: 'deposit' }));
  await flush();
  clickButton(view.container, 'Send Deposit Link');
  expect(view.container.textContent).not.toContain('Please add a Stripe payment link before sending');
  expect(view.container.textContent).toContain('Send deposit link of');
  view.cleanup();
});
