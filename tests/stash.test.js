// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { stash } from '../src/lib/stash';

afterEach(() => vi.restoreAllMocks());

it('remembers a value and forgets it again', () => {
  stash.set('k', { a: 1 });
  expect(stash.get('k')).toEqual({ a: 1 });
  stash.drop('k');
  expect(stash.get('k')).toBeNull();
});

it('does not throw when the browser blocks storage', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(stash.get('k')).toBeNull();
  expect(() => stash.set('k', 1)).not.toThrow();
  expect(() => stash.drop('k')).not.toThrow();
});

it('treats a damaged saved value as nothing', () => {
  sessionStorage.setItem('k', '{not json');
  expect(stash.get('k')).toBeNull();
});
