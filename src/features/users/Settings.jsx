import { useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useCtx } from '../../app/AuthProvider';
import { db } from '../../lib/firebase';
import { validTimeZone } from '../../lib/calc';
import { Alert, Button, Facts, Input, Modal, PageHeader, useAction, useForm } from '../../components/ui';

export default function Settings() {
  const { institution } = useCtx();
  const [info, setInfo] = useState(institution); // the context copy only refreshes on reload, so keep the saved values here
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState('');
  return (
    <>
      <PageHeader title="College settings">
        <Button variant="primary" onClick={() => { setSaved(''); setEditing(true); }}>Edit settings</Button>
      </PageHeader>
      <div className="card">
        <Alert kind="ok">{saved}</Alert>
        <Facts items={[['College name', info.name], ['Address', info.address], ['Contact', info.contact], ['Time zone', info.timezone]]} />
      </div>
      {editing && (
        <EditSettings info={info} onClose={(values) => {
          setEditing(false);
          if (values) { setInfo({ ...info, ...values }); setSaved('Saved. Reload the page to see a new time zone take effect.'); }
        }} />
      )}
    </>
  );
}

function EditSettings({ info, onClose }) {
  const { iid } = useCtx();
  const { values, bind } = useForm({
    name: info.name ?? '', address: info.address ?? '', contact: info.contact ?? '', timezone: info.timezone ?? '',
  });
  const { busy, error, run } = useAction();
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (!validTimeZone(values.timezone.trim())) throw new Error('That is not a valid time zone name (example: Asia/Kolkata).');
      const next = { ...values, timezone: values.timezone.trim() };
      await updateDoc(doc(db, 'institutions', iid), { ...next, updatedAt: serverTimestamp() });
      onClose(next);
    });
  };
  return (
    <Modal title="Edit college settings" onClose={() => onClose(null)}>
      <form onSubmit={save}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="College name" required {...bind('name')} />
          <Input label="Address" {...bind('address')} />
          <Input label="Contact" {...bind('contact')} />
          <Input label="Time zone" hint="Attendance dates use this time zone" required {...bind('timezone')} />
        </div>
        <div className="row">
          <Button onClick={() => onClose(null)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
