import { useEffect, useId, useRef, useState, useCallback } from 'react';

export function Button({ variant, small, className = '', ...props }) {
  return <button type="button" className={`btn ${variant ?? ''} ${small ? 'sm' : ''} ${className}`} {...props} />;
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Input({ label, hint, value, onChange, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

export function Select({ label, hint, value, onChange, options, placeholder = 'Select…', ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function Textarea({ label, value, onChange, ...rest }) {
  return (
    <Field label={label}>
      <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

export const Alert = ({ kind = 'info', children }) =>
  children ? <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> : null;

export const Badge = ({ kind, children }) => <span className={`badge ${kind ?? ''}`}>{children}</span>;

export const Loading = ({ text = 'Loading…' }) => <div className="center" role="status">{text}</div>;

export function PageHeader({ title, children }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      <div className="row">{children}</div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, wide, children }) {
  const titleId = useId();
  const ref = useRef();
  // Callers pass a new onClose every render; a ref keeps the effect from re-running (and stealing focus) on each keystroke.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    (ref.current.querySelector('[data-autofocus]') ?? ref.current).focus();
    const onKey = (e) => {
      if (e.key === 'Escape') return close.current();
      if (e.key !== 'Tab') return;
      const items = [...ref.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      if (!items.length) return;
      const at = document.activeElement;
      if (e.shiftKey && (at === items[0] || at === ref.current)) { e.preventDefault(); items.at(-1).focus(); }
      else if (!e.shiftKey && at === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Read-only details; edits happen in a modal. items: [[label, value]]
export const Facts = ({ items }) => (
  <dl className="facts">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
);

// Asks first, then runs the action. Render `dialog` once in the screen: ask({ title, body, label, danger }, fn).
export function useConfirm() {
  const [req, setReq] = useState(null);
  const ask = (opts, fn) => setReq({ ...opts, fn });
  const close = () => setReq(null);
  const dialog = req && (
    <Modal title={req.title} onClose={close}>
      {req.body && <p className="muted">{req.body}</p>}
      <div className="modal-actions">
        <Button onClick={close}>Cancel</Button>
        <Button variant={req.danger === false ? 'primary' : 'danger'} onClick={() => { close(); req.fn(); }}>{req.label ?? 'Confirm'}</Button>
      </div>
    </Modal>
  );
  return { ask, dialog };
}

// columns: [{ key, label, render? }]
// rows is undefined when the load failed; the screen shows the error above, so draw an empty table, not a crash.
export function Table({ columns, rows = [], empty = 'Nothing here yet.', actions }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
            {actions && <th scope="col"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id ?? JSON.stringify(r)}>
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key]}</td>)}
              {actions && <td className="actions">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Runs an async function and tracks loading, error and result.
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: undefined, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => live && setState({ data, loading: false, error: null }),
      (error) => live && setState({ data: undefined, loading: false, error }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

// Wraps a submit handler with a busy flag and an error message.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const run = useCallback(async (fn, successMessage = '') => {
    setBusy(true); setError(''); setDone('');
    try {
      const result = await fn();
      setDone(successMessage);
      return result;
    } catch (e) {
      setError(friendly(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, done, run };
}

export function friendly(e) {
  const code = e?.code ?? '';
  if (code === 'permission-denied') return 'You are not allowed to do that (or the college is suspended).';
  if (code === 'auth/email-already-in-use') return 'That email already has an account. Ask the platform admin to free it if it belongs to another college.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'Wrong email or password.';
  if (code === 'resource-exhausted') return 'The free daily quota is used up. Try again after it resets.';
  return e?.message ?? String(e);
}

export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const bind = (name) => ({ value: values[name], onChange: (v) => setValues((s) => ({ ...s, [name]: v })) });
  return { values, bind, set: setValues };
}

export const toOptions = (docs, label = 'name') => docs.map((d) => ({ value: d.id, label: d[label] ?? d.id }));

export function downloadCsv(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
