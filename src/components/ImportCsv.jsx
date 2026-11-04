import { useState } from 'react';
import { parseCsv, toCsv } from '../lib/calc';
import { Alert, Button, Modal, Field, downloadCsv, friendly } from './ui';

// Pick a CSV, see how many rows it has, import them one by one, and read what failed (row number and reason).
// `save(row)` saves one row and throws a message for a bad one; rows that already exist are reported, never doubled.
export default function ImportCsv({ title, noun, columns, sample, ready, save, onClose, children }) {
  const [rows, setRows] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const choose = async (e) => {
    setResult(null);
    const file = e.target.files[0];
    if (!file) return;
    const [head, ...body] = parseCsv(await file.text());
    const names = (head ?? []).map((h) => h.trim());
    const missing = columns.filter((c) => !names.includes(c));
    if (missing.length) { setRows(null); setProblem(`The first line must contain these columns: ${columns.join(', ')}. Missing: ${missing.join(', ')}.`); return; }
    if (!body.length) { setRows(null); setProblem('The file has no rows under the first line.'); return; }
    if (body.length > 300) { setRows(null); setProblem('Please import at most 300 rows at a time.'); return; }
    setProblem('');
    setRows(body.map((cells) => Object.fromEntries(names.map((n, i) => [n, (cells[i] ?? '').trim()]))));
  };

  const start = async () => {
    setBusy(true);
    const failed = [];
    let saved = 0;
    for (const [i, row] of rows.entries()) {
      try { await save(row); saved += 1; } catch (err) { failed.push([i + 2, friendly(err)]); }
    }
    setBusy(false);
    setResult({ saved, failed });
  };

  return (
    <Modal title={title} onClose={() => onClose(Boolean(result?.saved))}>
      <p className="muted">Use a CSV file with these columns on the first line: <strong>{columns.join(', ')}</strong>. Rows that already exist are skipped with a message, so it is safe to run a file again.</p>
      <p><Button small onClick={() => downloadCsv(`${noun}-template.csv`, toCsv([columns, sample]))}>Download a template</Button></p>
      {children}
      <Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={choose} disabled={busy} /></Field>
      <Alert kind="error">{problem}</Alert>
      {rows && !result && <p>{rows.length} {rows.length === 1 ? noun : `${noun}s`} found in the file.</p>}
      {result && (
        <>
          <Alert kind={result.failed.length ? 'error' : 'ok'}>{result.saved} imported, {result.failed.length} not imported.</Alert>
          {result.failed.length > 0 && <ul>{result.failed.map(([n, msg]) => <li key={n}>Row {n}: {msg}</li>)}</ul>}
        </>
      )}
      <div className="modal-actions">
        <Button onClick={() => onClose(Boolean(result?.saved))}>Close</Button>
        <Button variant="primary" disabled={busy || !rows || !ready || Boolean(result)} onClick={start}>{busy ? 'Importing…' : 'Import'}</Button>
      </div>
    </Modal>
  );
}
