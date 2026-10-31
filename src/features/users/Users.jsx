import { useRef, useState } from 'react';
import { doc, limit, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { ROLES, tcol } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { createAuthUser, list, sendSetPasswordEmail } from '../../lib/data';
import { Alert, Badge, Button, Input, Loading, Modal, PageHeader, Table, Tabs, useAction, useAsync, useForm } from '../../components/ui';
import { collection } from 'firebase/firestore';

export default function Users() {
  const [tab, setTab] = useState('users');
  return (
    <>
      <PageHeader title="Users & audit log" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Users' }, { value: 'audit', label: 'Audit log' }]} />
      {tab === 'users' ? <UserList /> : <AuditLog />}
    </>
  );
}

function UserList() {
  const { iid, uid, role } = useCtx();
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAsync(
    // Admin accounts only: the college's students and faculty are thousands of rows with nothing to do here.
    async () => (await Promise.all(['SUPER_ADMIN', 'COLLEGE_ADMIN'].map((r) =>
      list(query(collection(db, 'users'), where('institutionId', '==', iid), where('role', '==', r)))))).flat(),
    [iid],
  );
  const action = useAction();
  const isSuper = role === ROLES.SUPER_ADMIN;
  // Only the Super Admin blocks College Admins. Faculty and students are deactivated from their own profile pages,
  // which also change the profile status in the same batch.
  const manageable = (u) => isSuper && u.role === ROLES.COLLEGE_ADMIN && u.id !== uid;

  const setActive = (u, active) =>
    action.run(async () => {
      const batch = writeBatch(db);
      const auditId = audit(batch, { iid, uid }, active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', 'users', u.id, { role: u.role });
      batch.update(doc(db, 'users', u.id), { active, updatedAt: serverTimestamp(), auditId });
      await batch.commit();
      reload();
    });

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        {isSuper && <Button variant="primary" onClick={() => setCreating(true)}>Add College Admin</Button>}
      </div>
      <Alert kind="info">This list shows admin accounts. Faculty and student logins are created and deactivated from their own profile pages.</Alert>
      <Alert kind="error">{error?.message || action.error}</Alert>
      {loading ? <Loading /> : (
        <Table
          rows={data}
          columns={[
            { key: 'displayName', label: 'Name' }, { key: 'email', label: 'Email' },
            { key: 'role', label: 'Role', render: (u) => u.role.replace('_', ' ').toLowerCase() },
            { key: 'active', label: 'Status', render: (u) => <Badge kind={u.active ? 'ok' : 'bad'}>{u.active ? 'Active' : 'Blocked'}</Badge> },
          ]}
          actions={(u) => manageable(u) && (u.active
            ? <Button small variant="danger" disabled={action.busy} onClick={() => setActive(u, false)}>Block</Button>
            : <Button small disabled={action.busy} onClick={() => setActive(u, true)}>Unblock</Button>)}
        />
      )}
      {creating && <CreateAdmin onClose={(saved) => { setCreating(false); if (saved) reload(); }} />}
    </>
  );
}

function CreateAdmin({ onClose }) {
  const { iid, uid } = useCtx();
  const { values, bind } = useForm({ name: '', email: '' });
  const { busy, error, run } = useAction();
  const uidCache = useRef({});
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const email = values.email.trim().toLowerCase();
      const newUid = (uidCache.current[email] ??= await createAuthUser(email));
      const batch = writeBatch(db);
      const auditId = audit(batch, { iid, uid }, 'USER_CREATED', 'users', newUid, { role: ROLES.COLLEGE_ADMIN });
      batch.set(doc(db, 'users', newUid), {
        institutionId: iid, role: ROLES.COLLEGE_ADMIN, displayName: values.name.trim(), email, active: true,
        auditId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await batch.commit();
      await sendSetPasswordEmail(email).catch(() => {});
      onClose(true);
    });
  };
  return (
    <Modal title="Add College Admin" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Full name" required {...bind('name')} />
          <Input label="Email" type="email" required {...bind('email')} />
        </div>
        <p className="muted">They get an email to set their own password.</p>
        <div className="row">
          <Button variant="primary" type="submit" disabled={busy}>Create</Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

function AuditLog() {
  const { iid } = useCtx();
  const { data, loading, error } = useAsync(() => list(query(tcol(iid, 'auditLogs'), orderBy('timestamp', 'desc'), limit(100))), [iid]);
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  return (
    <Table
      rows={data}
      empty="Nothing logged yet."
      columns={[
        { key: 'timestamp', label: 'When', render: (l) => l.timestamp?.toDate?.().toLocaleString() ?? '' },
        { key: 'action', label: 'Action' }, { key: 'entityType', label: 'Entity' },
        { key: 'actorUid', label: 'By (uid)' },
        { key: 'metadata', label: 'Details', render: (l) => JSON.stringify(l.metadata ?? {}) },
      ]}
    />
  );
}
