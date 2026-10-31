// @vitest-environment jsdom
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import Landing from '../src/features/landing/Landing.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('has one main heading, a skip link, a way to sign in, and no empty links', async () => {
  const el = document.body.appendChild(document.createElement('div'));
  const root = createRoot(el);
  await act(() => root.render(h(MemoryRouter, null, h(Landing))));
  expect(el.querySelectorAll('h1')).toHaveLength(1);
  expect(el.querySelector('a.lp-skip').getAttribute('href')).toBe('#main');
  expect(el.querySelector('main#main')).not.toBeNull();
  const signIn = [...el.querySelectorAll('a')].filter((a) => a.textContent.trim().startsWith('Sign in'));
  expect(signIn.length).toBeGreaterThanOrEqual(2);
  signIn.forEach((a) => expect(a.getAttribute('href')).toBe('/login'));
  // every in-page link points at a section that exists
  [...el.querySelectorAll('a[href^="#"]')].forEach((a) => {
    const id = a.getAttribute('href').slice(1);
    expect(el.querySelector(`#${id}`), id).not.toBeNull();
  });
  await act(() => root.unmount());
});
