import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { ROLES } from '../../lib/tenant';
import { sendSetPasswordEmail } from '../../lib/data';
import FilePanel from '../../components/FilePanel';
import { Alert, Button, Input, Modal, PageHeader, useAction, useForm } from '../../components/ui';

export default function Profile() {
  const { profile, role } = useCtx();
  const { busy, error, done, run } = useAction();
  const [changing, setChanging] = useState(false);
  const ownerId = role === ROLES.FACULTY ? profile.facultyId : profile.studentId;
  const collection = role === ROLES.FACULTY ? 'faculty' : 'students';
  return (
    <>
      <PageHeader title="My profile" />
      <div className="card">
        <p><strong>{profile.displayName}</strong><br />{profile.email}</p>
        <Alert kind="error">{error}</Alert>
        <Alert kind="ok">{done}</Alert>
        <Button disabled={busy} onClick={() => run(() => sendSetPasswordEmail(profile.email), 'A password reset link was emailed to you.')}>
          Email me a password reset link
        </Button>{' '}
        <Button onClick={() => setChanging(true)}>Change password</Button>
      </div>
      {role !== ROLES.LIBRARIAN && <div className="card">
        <h2>My documents</h2>
        {role === ROLES.FACULTY
          ? <FilePanel collection={collection} ownerId={ownerId} canUpload />
          : <><p className="muted">Your college uploads these. You can download them here.</p><FilePanel collection={collection} ownerId={ownerId} canUpload={false} canRemove={() => false} /></>}
      </div>}
      {changing && <ChangePassword onClose={() => setChanging(false)} />}
    </>
  );
}

function ChangePassword({ onClose }) {
  const { values, bind } = useForm({ current: '', next: '', again: '' });
  const { busy, error, done, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (values.next.length < 8) throw new Error('The new password needs at least 8 characters.');
      if (values.next !== values.again) throw new Error('The two new passwords are not the same.');
      const user = auth.currentUser;
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, values.current));
      await updatePassword(user, values.next);
    }, 'Your password was changed.');
  };
  return (
    <Modal title="Change password" onClose={onClose}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <Alert kind="ok">{done}</Alert>
        <div className="form-grid">
          <Input label="Current password" type="password" autoComplete="current-password" required {...bind('current')} />
          <Input label="New password" type="password" autoComplete="new-password" required minLength={8} {...bind('next')} />
          <Input label="New password again" type="password" autoComplete="new-password" required {...bind('again')} />
        </div>
        <div className="row">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
        </div>
      </form>
    </Modal>
  );
}
