// sessionStorage can be blocked or full (private modes, strict privacy settings). Then nothing is remembered, nothing throws.
export const stash = {
  get(key) {
    try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* blocked or full: the bell just asks again */ }
  },
  drop(key) {
    try { sessionStorage.removeItem(key); } catch { /* blocked */ }
  },
};
