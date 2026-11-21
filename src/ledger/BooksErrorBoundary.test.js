import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { BooksErrorBoundary } from './BooksPage';

function Boom() {
  throw new RangeError('Invalid time value');
}

test('a crash inside Books shows a message instead of blanking the app', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => { root.render(<BooksErrorBoundary><Boom /></BooksErrorBoundary>); });
  expect(el.querySelector('[role="alert"]').textContent).toMatch(/Books hit an error/);
  expect(el.textContent).toMatch(/Back to Books/);
  act(() => root.unmount());
  spy.mockRestore();
});
