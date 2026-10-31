import { useRef, useState } from 'react';
import { doc, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { createAuthUser, list, sendSetPasswordEmail } from '../../lib/data';
import { usePaged } from '../../lib/paged';
import { Alert, Badge, Button, Input, Modal, PageHeader, Select, Table, toOptions, useAction, useAsync, useForm } from '../../components/ui';

export default function Faculty() {
  const { iid } = useCtx();
  const [status, setStatus] = useState('ACTIVE');
  const [creating, setCreating] = useState(false);
  const page = usePaged(
    () => query(tcol(iid, 'faculty'), ...(status ? [where('status', '==', status)] : []), orderBy('name')),
    [iid, status],
  );
  return (
    <>
      <PageHeader title="Faculty">
        <Button variant="primary" onClick={() => setCreating(true)}>Add faculty</Button>
      </PageHeader>
      <div className="row" style={{ marginBottom: 12 }}>
        <Select label="Status" value={status} onChange={setStatus} placeholder="All"
          options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
      </div>
      <Alert kind="error">{page.error?.message}</Alert>
      <Table
        rows={page.rows}
        empty={page.loading ? 'Loading…' : 'No faculty found.'}
        columns={[
          { key: 'name', label: 'Name', render: (f) => <Link to={`/faculty/${f.id}`}>{f.name}</Link> },
          { key: 'employeeCode', label: 'Employee code' },
          { key: 'designation', label: 'Designation' },
          { key: 'status', label: 'Status', render: (f) => <Badge kind={f.status === 'ACTIVE' ? 'ok' : 'bad'}>{f.status}</Badge> },
        ]}
      />
      {page.more && <div className="row" style={{ marginTop: 12 }}><Button onClick={page.loadMore}>Load more</Button></div>}
      {creating && <CreateFaculty onClose={(saved) => { setCreating(false); if (saved) page.reload(); }} />}
    </>
  );
}

function CreateFaculty({ onClose }) {
  const { iid, uid } = useCtx();
  const departments = useAsync(() => list(tcol(iid, 'departments')), [iid]);
  const { values, bind } = useForm({ employeeCode: '', name: '', email: '', phone: '', departmentId: '', designation: '' });
  const { busy, error, run } = useAction();
  const uidCache = useRef({});

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const email = values.email.trim().toLowerCase();
      const loginUid = (uidCache.current[email] ??= await createAuthUser(email));
      const ref = doc(tcol(iid, 'faculty'));
      const batch = writeBatch(db);
      const stamps = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      batch.set(ref, {
        uid: loginUid, employeeCode: values.employeeCode.trim(), name: values.name.trim(), email,
        phone: values.phone.trim(), departmentId: values.departmentId, designation: values.designation.trim(),
        status: 'ACTIVE', ...stamps,
      });
      const auditId = audit(batch, { iid, uid }, 'FACULTY_CREATED', 'faculty', ref.id, {});
      batch.set(doc(db, 'users', loginUid), {
        institutionId: iid, role: 'FACULTY', displayName: values.name.trim(), email, facultyId: ref.id,
        active: true, auditId, ...stamps,
      });
      await batch.commit();
      await sendSetPasswordEmail(email).catch(() => {});
      onClose(true);
    });
  };

  return (
    <Modal title="Add faculty" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Employee code" required {...bind('employeeCode')} />
          <Input label="Full name" required {...bind('name')} />
          <Input label="Email (used to sign in)" type="email" required {...bind('email')} />
          <Input label="Phone" {...bind('phone')} />
          <Select label="Department" required options={toOptions(departments.data ?? [])} {...bind('departmentId')} />
          <Input label="Designation" {...bind('designation')} />
        </div>
        <p className="muted">They get an email to set their own password.</p>
        <div className="row">
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
