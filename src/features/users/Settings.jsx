import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useCtx } from '../../app/AuthProvider';
import { db } from '../../lib/firebase';
import { validTimeZone } from '../../lib/calc';
import { Alert, Button, Input, PageHeader, useAction, useForm } from '../../components/ui';

export default function Settings() {
  const { iid, institution } = useCtx();
  const { values, bind } = useForm({
    name: institution.name ?? '', address: institution.address ?? '', contact: institution.contact ?? '', timezone: institution.timezone ?? '',
  });
  const { busy, error, done, run } = useAction();
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (!validTimeZone(values.timezone.trim())) throw new Error('That is not a valid time zone name (example: Asia/Kolkata).');
      await updateDoc(doc(db, 'institutions', iid), { ...values, timezone: values.timezone.trim(), updatedAt: serverTimestamp() });
    }, 'Saved. Reload the page to see a new time zone take effect.');
  };
  return (
    <>
      <PageHeader title="College settings" />
      <form className="card" onSubmit={save}>
        <Alert kind="error">{error}</Alert>
        <Alert kind="ok">{done}</Alert>
        <div className="form-grid">
          <Input label="College name" required {...bind('name')} />
          <Input label="Address" {...bind('address')} />
          <Input label="Contact" {...bind('contact')} />
          <Input label="Time zone" hint="Attendance dates use this time zone" required {...bind('timezone')} />
        </div>
        <div className="row" style={{ marginTop: 12 }}><Button variant="primary" type="submit" disabled={busy}>Save</Button></div>
      </form>
    </>
  );
}
