import { useRef, useState } from 'react';
import { doc, getDoc, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol, tdoc } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { enrollmentKey, toCsv } from '../../lib/calc';
import { createAuthUser, list, sendSetPasswordEmail } from '../../lib/data';
import { usePaged } from '../../lib/paged';
import { Alert, Badge, Button, Input, Modal, PageHeader, Select, Table, downloadCsv, toOptions, useAction, useAsync, useForm } from '../../components/ui';
import ImportCsv from '../../components/ImportCsv';
import Promote from './Promote';

export default function Students() {
  const { iid } = useCtx();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [creating, setCreating] = useState(false);
  const [tool, setTool] = useState(null); // 'import' | 'promote'
  const key = enrollmentKey(search);
  const page = usePaged(() => {
    const c = [];
    if (status) c.push(where('status', '==', status));
    if (key) c.push(where('enrollmentKey', '>=', key), where('enrollmentKey', '<=', `${key}`));
    return query(tcol(iid, 'students'), ...c, orderBy('enrollmentKey'));
  }, [iid, status, key]);

  return (
    <>
      <PageHeader title="Students">
        <Button variant="primary" onClick={() => setCreating(true)}>Add student</Button>
        <Button onClick={() => setTool('import')}>Import CSV</Button>
        <Button onClick={() => setTool('promote')}>Promote a class</Button>
        <Button onClick={() => downloadCsv('students.csv', toCsv([['Enrollment number', 'Name', 'Email', 'Phone', 'Admission date', 'Status'],
          ...page.rows.map((r) => [r.enrollmentNumber, r.name, r.email, r.phone, r.admissionDate, r.status])]))} disabled={!page.rows.length}>Export CSV</Button>
      </PageHeader>
      <div className="row" style={{ marginBottom: 12 }}>
        <Input label="Search by enrollment number" value={search} onChange={setSearch} />
        <Select
          label="Status" value={status} onChange={setStatus} placeholder="All"
          options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]}
        />
      </div>
      <Alert kind="error">{page.error?.message}</Alert>
      <Table
        rows={page.rows}
        empty={page.loading ? 'Loading…' : 'No students found.'}
        columns={[
          { key: 'enrollmentNumber', label: 'Enrollment no.', render: (s) => <Link to={`/students/${s.id}`}>{s.enrollmentNumber}</Link> },
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'status', label: 'Status', render: (s) => <Badge kind={s.status === 'ACTIVE' ? 'ok' : 'bad'}>{s.status}</Badge> },
        ]}
      />
      {page.more && <div className="row" style={{ marginTop: 12 }}><Button onClick={page.loadMore}>Load more</Button></div>}
      {tool === 'import' && <ImportStudents onClose={(saved) => { setTool(null); if (saved) page.reload(); }} />}
      {tool === 'promote' && <Promote onClose={() => setTool(null)} />}
      {creating && <CreateStudent onClose={(saved) => { setCreating(false); if (saved) page.reload(); }} />}
    </>
  );
}

// Saves one student and, when asked, their login. Shared by the form and the CSV import.
// `uids` remembers Auth accounts created by an attempt that failed later, so a retry reuses them.
async function saveStudent({ iid, uid }, values, uids) {
  const number = values.enrollmentNumber.trim();
  const key = enrollmentKey(number);
  // Check first: a duplicate must not leave an orphaned Auth account behind.
  if ((await getDoc(tdoc(iid, 'enrollmentNumberIndex', key))).exists()) {
    throw new Error('A student with this enrollment number already exists.');
  }
  const email = values.email.trim().toLowerCase();
  const wantLogin = values.login && email;
  const loginUid = wantLogin ? (uids[email] ??= await createAuthUser(email)) : null;

  const studentRef = doc(tcol(iid, 'students'));
  const batch = writeBatch(db);
  const stamps = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  batch.set(tdoc(iid, 'enrollmentNumberIndex', key), { studentId: studentRef.id, ...stamps });
  batch.set(studentRef, {
    uid: loginUid, enrollmentNumber: number, enrollmentKey: key, name: values.name.trim(), email,
    phone: values.phone.trim(), admissionDate: values.admissionDate, departmentId: values.departmentId,
    courseId: values.courseId, status: 'ACTIVE', ...stamps,
  });
  const auditId = audit(batch, { iid, uid }, 'STUDENT_CREATED', 'students', studentRef.id, { enrollmentNumber: number });
  if (loginUid) {
    batch.set(doc(db, 'users', loginUid), {
      institutionId: iid, role: 'STUDENT', displayName: values.name.trim(), email, studentId: studentRef.id,
      active: true, auditId, ...stamps,
    });
  }
  try {
    await batch.commit();
  } catch (err) {
    if (err.code === 'permission-denied') {
      throw new Error('Could not save. The enrollment number may have just been taken, or you lack permission.');
    }
    throw err;
  }
  if (loginUid) await sendSetPasswordEmail(email).catch(() => {});
}

function CreateStudent({ onClose }) {
  const { iid, uid } = useCtx();
  const refs = useAsync(async () => ({
    departments: await list(tcol(iid, 'departments')),
    courses: await list(tcol(iid, 'courses')),
  }), [iid]);
  const { values, bind } = useForm({
    enrollmentNumber: '', name: '', email: '', phone: '', admissionDate: '', departmentId: '', courseId: '', login: true,
  });
  const { busy, error, run } = useAction();
  const uidCache = useRef({}); // a retry reuses an Auth account created by a failed attempt

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await saveStudent({ iid, uid }, values, uidCache.current);
      onClose(true);
    });
  };

  return (
    <Modal title="Add student" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Enrollment number" required {...bind('enrollmentNumber')} />
          <Input label="Full name" required {...bind('name')} />
          <Input label="Email" type="email" {...bind('email')} />
          <Input label="Phone" {...bind('phone')} />
          <Input label="Admission date" type="date" required {...bind('admissionDate')} />
          <Select label="Department" required options={toOptions(refs.data?.departments ?? [])} {...bind('departmentId')} />
          <Select label="Course" required options={toOptions(refs.data?.courses ?? [])} {...bind('courseId')} />
        </div>
        <label style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
          <input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={values.login} onChange={(e) => bind('login').onChange(e.target.checked)} />
          Create a login and email a link to set the password (needs an email)
        </label>
        <div className="row">
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportStudents({ onClose }) {
  const { iid, uid } = useCtx();
  const refs = useAsync(async () => ({ departments: await list(tcol(iid, 'departments')), courses: await list(tcol(iid, 'courses')) }), [iid]);
  const { values, bind } = useForm({ departmentId: '', courseId: '', login: true });
  const uids = useRef({});
  return (
    <ImportCsv
      title="Import students" noun="student" columns={['enrollmentNumber', 'name', 'email', 'phone', 'admissionDate']}
      sample={['A001', 'Asha Rao', 'asha@example.com', '9999999999', '2026-07-01']}
      ready={Boolean(values.departmentId && values.courseId)} onClose={onClose}
      save={(row) => {
        if (!row.enrollmentNumber || !row.name || !/^\d{4}-\d{2}-\d{2}$/.test(row.admissionDate)) throw new Error('Needs an enrollment number, a name and an admission date like 2026-07-01.');
        return saveStudent({ iid, uid }, { ...row, departmentId: values.departmentId, courseId: values.courseId, login: values.login }, uids.current);
      }}
    >
      <div className="form-grid">
        <Select label="Department (for every row)" required options={toOptions(refs.data?.departments ?? [])} {...bind('departmentId')} />
        <Select label="Course (for every row)" required options={toOptions(refs.data?.courses ?? [])} {...bind('courseId')} />
      </div>
      <label style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={values.login} onChange={(e) => bind('login').onChange(e.target.checked)} />
        Create a login for rows that have an email
      </label>
    </ImportCsv>
  );
}
