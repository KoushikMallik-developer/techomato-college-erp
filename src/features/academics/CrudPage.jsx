import { useState } from 'react';
import { addDoc, doc, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useCtx } from '../../app/AuthProvider';
import { tcol, tdoc } from '../../lib/tenant';
import { byId, list } from '../../lib/data';
import { Alert, Button, Input, Loading, Modal, Select, Table, useAction, useAsync, useForm } from '../../components/ui';

// config: { collection, singular, fields: [{ name, label, type?, ref?, options?, required?, hint? }], columns: [name...] }
export default function CrudPage({ config }) {
  const { iid } = useCtx();
  const [editing, setEditing] = useState(null);
  const refs = config.fields.filter((f) => f.ref);
  const { data, loading, error, reload } = useAsync(async () => {
    const [rows, ...lookups] = await Promise.all([
      list(query(tcol(iid, config.collection), orderBy(config.orderBy ?? 'name'))),
      ...refs.map((f) => list(tcol(iid, f.ref.collection))),
    ]);
    return { rows, lookups: Object.fromEntries(refs.map((f, i) => [f.name, byId(lookups[i])])), raw: lookups };
  }, [iid, config.collection]);

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;

  const show = (row, f) => {
    if (f.ref) return data.lookups[f.name][row[f.name]]?.[f.ref.label ?? 'name'] ?? '—';
    if (f.type === 'bool') return row[f.name] ? 'Yes' : 'No';
    return row[f.name] ?? '';
  };
  const colFields = config.fields.filter((f) => config.columns.includes(f.name));

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button variant="primary" onClick={() => setEditing({})}>Add {config.singular}</Button>
      </div>
      <Table
        rows={data.rows}
        columns={colFields.map((f) => ({ key: f.name, label: f.label, render: (r) => show(r, f) }))}
        actions={(r) => <Button small onClick={() => setEditing(r)}>Edit</Button>}
      />
      {editing && (
        <RecordForm
          config={config}
          record={editing}
          lookups={data.lookups}
          onClose={(saved) => { setEditing(null); if (saved) reload(); }}
        />
      )}
    </>
  );
}

function RecordForm({ config, record, lookups, onClose }) {
  const { iid } = useCtx();
  const initial = Object.fromEntries(config.fields.map((f) => [f.name, record[f.name] ?? (f.type === 'bool' ? true : f.default ?? '')]));
  const { values, bind } = useForm(initial);
  const { busy, error, run } = useAction();

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const data = {};
      for (const f of config.fields) {
        let v = values[f.name];
        if (f.type === 'number') v = Number(v);
        if (f.type === 'bool') v = v === true || v === 'true';
        data[f.name] = typeof v === 'string' ? v.trim() : v;
      }
      for (const f of config.fields.filter((x) => x.ref)) {
        // keep denormalised display fields in step with their source
        const src = lookups[f.name][data[f.name]];
        if (src && f.copy) for (const [to, from] of Object.entries(f.copy)) data[to] = src[from];
      }
      if (config.beforeSave) Object.assign(data, config.beforeSave(data, lookups));
      if (record.id) await updateDoc(tdoc(iid, config.collection, record.id), { ...data, updatedAt: serverTimestamp() });
      else await addDoc(tcol(iid, config.collection), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      onClose(true);
    });
  };

  const options = (f) =>
    f.ref
      ? Object.values(lookups[f.name]).map((d) => ({ value: d.id, label: d[f.ref.label ?? 'name'] ?? d.id }))
      : f.options;

  return (
    <Modal title={`${record.id ? 'Edit' : 'Add'} ${config.singular}`} onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          {config.fields.map((f) =>
            f.ref || f.options || f.type === 'bool' ? (
              <Select
                key={f.name}
                label={f.label}
                required={f.required !== false}
                options={f.type === 'bool' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : options(f)}
                value={f.type === 'bool' ? String(values[f.name]) : values[f.name]}
                onChange={bind(f.name).onChange}
                hint={f.hint}
              />
            ) : (
              <Input
                key={f.name}
                label={f.label}
                hint={f.hint}
                type={f.type ?? 'text'}
                required={f.required !== false}
                {...bind(f.name)}
              />
            ),
          )}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
