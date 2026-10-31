import { useRef, useState } from 'react';
import { collection, doc, getDocs, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { platformAudit } from '../../lib/audit';
import { createAuthUser, sendSetPasswordEmail, slug } from '../../lib/data';
import { Alert, Badge, Button, Input, Modal, PageHeader, Table, useAction, useAsync, useForm } from '../../components/ui';

const blank = { name: '', code: '', timezone: 'Asia/Kolkata', plan: '', adminName: '', adminEmail: '' };

export default function Colleges() {
  const { uid } = useCtx();
  const [open, setOpen] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const snap = await getDocs(query(collection(db, 'institutions'), orderBy('name')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }, []);
  const action = useAction();

  const setStatus = (c, status) =>
    action.run(async () => {
      const batch = writeBatch(db);
      const auditId = platformAudit(batch, uid, `COLLEGE_${status}`, c.id, { name: c.name });
      batch.update(doc(db, 'institutions', c.id), { status, updatedAt: serverTimestamp(), auditId });
      await batch.commit();
      reload();
    });

  return (
    <>
      <PageHeader title="Colleges">
        <Button variant="primary" onClick={() => setOpen(true)}>Create college</Button>
      </PageHeader>
      <Alert kind="error">{error?.message || action.error}</Alert>
      <Alert kind="info">
        You manage colleges only. You cannot read any college's students, attendance or marks. Suspending a college locks
        all its users out on their next request.
      </Alert>
      {loading ? <p>Loading…</p> : (
        <Table
          rows={data}
          columns={[
            { key: 'name', label: 'College' },
            { key: 'code', label: 'Code' },
            { key: 'timezone', label: 'Time zone' },
            { key: 'status', label: 'Status', render: (c) => <Badge kind={c.status === 'ACTIVE' ? 'ok' : 'bad'}>{c.status}</Badge> },
            { key: 'plan', label: 'Plan note' },
          ]}
          actions={(c) =>
            c.status === 'ACTIVE'
              ? <Button small variant="danger" disabled={action.busy} onClick={() => setStatus(c, 'SUSPENDED')}>Suspend</Button>
              : <Button small disabled={action.busy} onClick={() => setStatus(c, 'ACTIVE')}>Reactivate</Button>}
        />
      )}
      {open && <CreateCollege onClose={() => { setOpen(false); reload(); }} />}
    </>
  );
}

function CreateCollege({ onClose }) {
  const { uid } = useCtx();
  const { values, bind } = useForm(blank);
  const { busy, error, run } = useAction();
  const uidCache = useRef({}); // lets a retry reuse an Auth account created by a failed attempt

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const iid = slug(values.code);
      if (!iid) throw new Error('Enter a college code using letters or numbers.');
      const email = values.adminEmail.trim().toLowerCase();
      const adminUid = (uidCache.current[email] ??= await createAuthUser(email));
      const batch = writeBatch(db);
      const auditId = platformAudit(batch, uid, 'COLLEGE_CREATED', iid, { name: values.name });
      batch.set(doc(db, 'institutions', iid), {
        name: values.name.trim(), code: iid, timezone: values.timezone.trim(), plan: values.plan,
        status: 'ACTIVE', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), auditId,
      });
      batch.set(doc(db, 'users', adminUid), {
        institutionId: iid, role: 'SUPER_ADMIN', displayName: values.adminName.trim(), email, active: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), auditId,
      });
      await batch.commit();
      await sendSetPasswordEmail(email);
      onClose();
    });
  };

  return (
    <Modal title="Create college" onClose={onClose}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="College name" required {...bind('name')} />
          <Input label="Code" hint="Used as the college's ID. Letters and numbers only." required {...bind('code')} />
          <Input label="Time zone" hint="IANA name, e.g. Asia/Kolkata" required {...bind('timezone')} />
          <Input label="Plan note" {...bind('plan')} />
          <Input label="First Super Admin name" required {...bind('adminName')} />
          <Input label="First Super Admin email" type="email" required {...bind('adminEmail')} />
        </div>
        <p className="muted">The Super Admin gets an email to set their own password. You can create the Super Admin only now, together with the college.</p>
        <div className="row">
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
