import { useRef, useState } from 'react';
import { doc, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { createAuthUser, list, sendSetPasswordEmail } from '../../lib/data';
import { usePaged } from '../../lib/paged';
import { toCsv } from '../../lib/calc';
import { Alert, Badge, Button, Input, Modal, PageHeader, Select, Table, downloadCsv, toOptions, useAction, useAsync, useForm } from '../../components/ui';
import ImportCsv from '../../components/ImportCsv';

export default function Faculty() {
  const { iid } = useCtx();
  const [status, setStatus] = useState('ACTIVE');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const page = usePaged(
    () => query(tcol(iid, 'faculty'), ...(status ? [where('status', '==', status)] : []), orderBy('name')),
    [iid, status],
  );
  return (
    <>
      <PageHeader title="Faculty">
        <Button variant="primary" onClick={() => setCreating(true)}>Add faculty</Button>
        <Button onClick={() => setImporting(true)}>Import CSV</Button>
        <Button disabled={!page.rows.length} onClick={() => downloadCsv('faculty.csv', toCsv([['Employee code', 'Name', 'Email', 'Phone', 'Designation', 'Status'],
          ...page.rows.map((r) => [r.employeeCode, r.name, r.email, r.phone, r.designation, r.status])]))}>Export CSV</Button>
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
      {importing && <ImportFaculty onClose={(saved) => { setImporting(false); if (saved) page.reload(); }} />}
      {creating && <CreateFaculty onClose={(saved) => { setCreating(false); if (saved) page.reload(); }} />}
    </>
  );
}

// Saves one faculty member and their login. Shared by the form and the CSV import.
async function saveFaculty({ iid, uid }, values, uids) {
  const email = values.email.trim().toLowerCase();
  const loginUid = (uids[email] ??= await createAuthUser(email));
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
      await saveFaculty({ iid, uid }, values, uidCache.current);
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

function ImportFaculty({ onClose }) {
  const { iid, uid } = useCtx();
  const departments = useAsync(() => list(tcol(iid, 'departments')), [iid]);
  const { values, bind } = useForm({ departmentId: '' });
  const uids = useRef({});
  return (
    <ImportCsv
      title="Import faculty" noun="faculty member" columns={['employeeCode', 'name', 'email', 'phone', 'designation']}
      sample={['E001', 'Dr. Meera Nair', 'meera@example.com', '9999999999', 'Professor']}
      ready={Boolean(values.departmentId)} onClose={onClose}
      save={(row) => {
        if (!row.employeeCode || !row.name || !row.email) throw new Error('Needs an employee code, a name and an email.');
        return saveFaculty({ iid, uid }, { ...row, departmentId: values.departmentId }, uids.current);
      }}
    >
      <div className="form-grid">
        <Select label="Department (for every row)" required options={toOptions(departments.data ?? [])} {...bind('departmentId')} />
      </div>
    </ImportCsv>
  );
}
