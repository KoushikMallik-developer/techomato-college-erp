import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, getDoc, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol, tdoc } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { list } from '../../lib/data';
import FilePanel from '../../components/FilePanel';
import { Alert, Badge, Button, Input, Loading, PageHeader, Table, Tabs, useAction, useAsync, useForm } from '../../components/ui';

export default function FacultyDetail() {
  const { id } = useParams();
  const { iid } = useCtx();
  const [tab, setTab] = useState('profile');
  const { data: f, loading, error, reload } = useAsync(async () => {
    const snap = await getDoc(tdoc(iid, 'faculty', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }, [iid, id]);

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  if (!f) return <Alert kind="error">Faculty member not found.</Alert>;
  return (
    <>
      <PageHeader title={f.name}>
        <Badge kind={f.status === 'ACTIVE' ? 'ok' : 'bad'}>{f.status}</Badge>
        <Link to="/faculty">Back to faculty</Link>
      </PageHeader>
      <Tabs value={tab} onChange={setTab}
        tabs={[{ value: 'profile', label: 'Profile' }, { value: 'classes', label: 'Classes' }, { value: 'documents', label: 'Documents' }]} />
      {tab === 'profile' && <Profile f={f} reload={reload} />}
      {tab === 'classes' && <Classes f={f} />}
      {tab === 'documents' && <FilePanel collection="faculty" ownerId={f.id} canUpload />}
    </>
  );
}

function Profile({ f, reload }) {
  const { iid, uid } = useCtx();
  const { values, bind } = useForm({ name: f.name, phone: f.phone ?? '', designation: f.designation ?? '' });
  const { busy, error, done, run } = useAction();

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await updateDoc(tdoc(iid, 'faculty', f.id), { ...values, updatedAt: serverTimestamp() });
      reload();
    }, 'Saved.');
  };
  const setActive = (active) =>
    run(async () => {
      const batch = writeBatch(db);
      const auditId = audit(batch, { iid, uid }, active ? 'FACULTY_REACTIVATED' : 'FACULTY_DEACTIVATED', 'faculty', f.id, {});
      batch.update(tdoc(iid, 'faculty', f.id), { status: active ? 'ACTIVE' : 'INACTIVE', updatedAt: serverTimestamp() });
      if (f.uid) batch.update(doc(db, 'users', f.uid), { active, updatedAt: serverTimestamp(), auditId });
      await batch.commit();
      reload();
    }, active ? 'Reactivated.' : 'Deactivated. Their login is blocked. Replace them on their classes under Academics.');

  return (
    <form className="card" onSubmit={save}>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{done}</Alert>
      <div className="form-grid">
        <Input label="Employee code" value={f.employeeCode} onChange={() => {}} readOnly />
        <Input label="Email" value={f.email} onChange={() => {}} readOnly hint="Set at creation" />
        <Input label="Full name" required {...bind('name')} />
        <Input label="Phone" {...bind('phone')} />
        <Input label="Designation" {...bind('designation')} />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <Button variant="primary" type="submit" disabled={busy}>Save</Button>
        {f.status === 'ACTIVE'
          ? <Button variant="danger" disabled={busy} onClick={() => setActive(false)}>Deactivate</Button>
          : <Button disabled={busy} onClick={() => setActive(true)}>Reactivate</Button>}
      </div>
    </form>
  );
}

function Classes({ f }) {
  const { iid } = useCtx();
  const { data, loading } = useAsync(() => list(query(tcol(iid, 'teachingAssignments'), where('facultyId', '==', f.id))), [iid, f.id]);
  if (loading) return <Loading />;
  return (
    <Table
      rows={data}
      empty="No classes assigned. Assign them under Academics."
      columns={[
        { key: 'subjectName', label: 'Subject' },
        { key: 'sectionId', label: 'Section ID' },
        { key: 'active', label: 'Status', render: (a) => <Badge kind={a.active ? 'ok' : ''}>{a.active ? 'Active' : 'Ended'}</Badge> },
      ]}
    />
  );
}
