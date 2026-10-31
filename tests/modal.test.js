// @vitest-environment jsdom
import { createElement as h, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { Modal } from '../src/components/ui.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A form like the real ones: state lives in the parent, so every keystroke re-renders and passes a NEW onClose.
function Form() {
  const [text, setText] = useState('');
  return h(Modal, { title: 'Test', onClose: () => setText('') },
    h('input', { id: 'name', value: text, onChange: (e) => setText(e.target.value) }),
    h('button', { id: 'last' }, 'Save'));
}

let root;
afterEach(() => act(() => root.unmount()));

const mount = async () => {
  const el = document.body.appendChild(document.createElement('div'));
  root = createRoot(el);
  await act(() => root.render(h(Form)));
};
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const tab = (shiftKey = false) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true })); });

it('keeps focus in the field while typing (the dialog must not steal it on each re-render)', async () => {
  await mount();
  const input = document.getElementById('name');
  input.focus();
  await type(input, 'a');
  await type(input, 'ab');
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('ab');
});

it('wraps Tab inside the dialog', async () => {
  await mount();
  document.getElementById('last').focus();
  await tab();
  expect(document.activeElement.id).toBe('name');
  await tab(true);
  expect(document.activeElement.id).toBe('last');
});
