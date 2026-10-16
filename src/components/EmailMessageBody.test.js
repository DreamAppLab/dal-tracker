import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import EmailMessageBody from './EmailMessageBody';

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

test('shows only the new reply, and the full email on request', () => {
  const email = {
    direction: 'inbound',
    body: 'Option 1 is good.\n\nOn Tue, Oct 13, 2026 at 10:29 AM Dream App Lab wrote:\n> Hi Aaron, the proposal',
  };
  act(() => root.render(<EmailMessageBody email={email} />));
  expect(container.textContent).toContain('Option 1 is good.');
  expect(container.textContent).not.toContain('the proposal');

  const button = container.querySelector('button');
  expect(button.textContent).toBe('Show full email');
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(container.textContent).toContain('the proposal');
  expect(container.querySelector('button').textContent).toBe('Hide full email');
});

test('no link when nothing is hidden, and client markup is never rendered', () => {
  const email = { direction: 'inbound', body: 'Thanks <img src=x onerror="window.hacked=1">' };
  act(() => root.render(<EmailMessageBody email={email} />));
  expect(container.querySelector('button')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('<img src=x');
});
