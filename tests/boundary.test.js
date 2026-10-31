// @vitest-environment jsdom
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ErrorBoundary from '../src/components/ErrorBoundary.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('shows a message with a way out instead of a blank page when a screen throws', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = () => { throw new Error('boom'); };
  const el = document.body.appendChild(document.createElement('div'));
  const root = createRoot(el);
  await act(() => root.render(h(ErrorBoundary, { onSignOut: () => {} }, h(Broken))));
  expect(el.textContent).toContain('Something went wrong');
  expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Reload', 'Sign out']);
  await act(() => root.unmount());
});
