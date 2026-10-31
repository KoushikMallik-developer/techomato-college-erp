import { useState } from 'react';
import { collection, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth, db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { platformAudit } from '../../lib/audit';
import { loginEmail } from '../../lib/calc';
import { createAuthUser, list } from '../../lib/data';
import { Alert, Button, Input, Loading, Modal, PageHeader, Table, useAction, useAsync, useForm } from '../../components/ui';

const MIN = 6; // Firebase Auth refuses shorter passwords
const tooShort = `The password must be at least ${MIN} characters.`;

export default function PlatformAdmins() {
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useAsync(
    () => list(query(collection(db, 'users'), where('role', '==', 'PLATFORM_ADMIN'))), [],
  );
  return (
    <>
      <PageHeader title="Platform admins">
        <Button variant="primary" onClick={() => setAdding(true)}>Add platform admin</Button>
      </PageHeader>
      <ChangePassword />
      <div className="card">
        <h2>Platform admins</h2>
        <Alert kind="error">{error?.message}</Alert>
        {loading ? <Loading /> : (
          <Table rows={data} columns={[
            { key: 'displayName', label: 'Name' },
            { key: 'email', label: 'Sign in as', render: (u) => u.email.replace('@techomato.local', '') },
          ]} />
        )}
      </div>
      {adding && <AddAdmin onClose={(saved) => { setAdding(false); if (saved) reload(); }} />}
    </>
  );
}

function ChangePassword() {
  const { values, bind, set } = useForm({ current: '', next: '', again: '' });
  const { busy, error, done, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (values.next.length < MIN) throw new Error(tooShort);
      if (values.next !== values.again) throw new Error('The two new passwords are different.');
      const user = auth.currentUser;
      // Firebase wants a fresh sign-in before it lets anyone change a password.
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, values.current));
      await updatePassword(user, values.next);
      set({ current: '', next: '', again: '' });
    }, 'Password changed.');
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>Change my password</h2>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{done}</Alert>
      <div className="form-grid">
        <Input label="Current password" type="password" autoComplete="current-password" required {...bind('current')} />
        <Input label="New password" type="password" autoComplete="new-password" required {...bind('next')} />
        <Input label="New password again" type="password" autoComplete="new-password" required {...bind('again')} />
      </div>
      <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
    </form>
  );
}

function AddAdmin({ onClose }) {
  const { uid } = useCtx();
  const { values, bind } = useForm({ name: '', login: '', password: '' });
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (values.password.length < MIN) throw new Error(tooShort);
      const email = loginEmail(values.login);
      const newUid = await createAuthUser(email, values.password);
      const batch = writeBatch(db);
      const auditId = platformAudit(batch, uid, 'PLATFORM_ADMIN_CREATED', 'platform', { email });
      batch.set(doc(db, 'users', newUid), {
        institutionId: 'platform', role: 'PLATFORM_ADMIN', displayName: values.name.trim(), email, active: true,
        auditId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await batch.commit();
      onClose(true);
    });
  };
  return (
    <Modal title="Add platform admin" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Full name" required {...bind('name')} />
          <Input label="Email or username" hint="A plain username such as ravi is fine." required {...bind('login')} />
          <Input label="Password" type="password" autoComplete="new-password" required {...bind('password')} />
        </div>
        <p className="muted">A platform admin can create and suspend every college. Share the password in person, and ask them to change it.</p>
        <div className="row">
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
