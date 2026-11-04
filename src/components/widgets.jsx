import { useEffect, useState } from 'react';

const sunMoon = {
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
};

export function Icon({ d, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const systemTheme = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

// Light or dark. The choice is saved on this device; index.html applies it before the page paints.
export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || systemTheme());
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* storage blocked: the choice lasts until reload */ }
    setTheme(next);
  };
  return (
    <button type="button" className="icon-btn" onClick={flip} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>
      <Icon d={theme === 'dark' ? sunMoon.sun : sunMoon.moon} />
    </button>
  );
}

// Shown while the browser is offline: the app shell still opens, but saving needs a connection.
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online ? null : <div className="offline" role="status">You are offline. Saving and loading will work again when you reconnect.</div>;
}

// A progress ring: value 0-100, null while there is nothing to show yet.
export function Ring({ value, label }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const shown = value ?? 0;
  const tone = value === null ? 'none' : value >= 90 ? 'great' : value >= 75 ? 'ok' : 'low';
  return (
    <div className={`ring ${tone}`} role="img" aria-label={`${label}: ${value === null ? 'no data yet' : `${value} percent`}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} className="ring-bg" />
        <circle cx="60" cy="60" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} transform="rotate(-90 60 60)" />
      </svg>
      <div className="ring-num">{value === null ? '—' : `${Math.round(value)}%`}</div>
    </div>
  );
}

// The Techomato tomato with a face, for the student pages.
export function Mascot({ size = 64, mood = 'happy' }) {
  const mouth = mood === 'worried' ? 'M12 28c2-2 8-2 10 0' : 'M11.5 25.5c2 3.2 9 3.2 11 0';
  return (
    <svg className="mascot" width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="19" r="14" fill="var(--brand)" />
      <path d="M13 5c2 2 6 2 8 0" stroke="var(--leaf)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="12.5" cy="17.5" r="1.7" fill="#fff" /><circle cx="21.5" cy="17.5" r="1.7" fill="#fff" />
      <circle cx="12.9" cy="17.8" r=".8" fill="#17181c" /><circle cx="21.9" cy="17.8" r=".8" fill="#17181c" />
      <path d={mouth} stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export const greeting = (hour = new Date().getHours()) => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
