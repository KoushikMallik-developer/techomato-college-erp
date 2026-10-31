import { useCtx } from '../../app/AuthProvider';
import { ROLES } from '../../lib/tenant';
import { sendSetPasswordEmail } from '../../lib/data';
import FilePanel from '../../components/FilePanel';
import { Alert, Button, PageHeader, useAction } from '../../components/ui';

export default function Profile() {
  const { profile, role } = useCtx();
  const { busy, error, done, run } = useAction();
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
        </Button>
      </div>
      <div className="card">
        <h2>My documents</h2>
        {role === ROLES.FACULTY
          ? <FilePanel collection={collection} ownerId={ownerId} canUpload />
          : <><p className="muted">Your college uploads these. You can download them here.</p><FilePanel collection={collection} ownerId={ownerId} canUpload={false} canRemove={() => false} /></>}
      </div>
    </>
  );
}
