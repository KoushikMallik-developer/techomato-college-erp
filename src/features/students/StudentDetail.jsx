import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol, tdoc } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { byId, list } from '../../lib/data';
import FilePanel from '../../components/FilePanel';
import { Alert, Badge, Button, Facts, Input, Loading, Modal, PageHeader, Select, Table, Tabs, toOptions, useAction, useAsync, useConfirm, useForm } from '../../components/ui';

export default function StudentDetail() {
  const { id } = useParams();
  const { iid } = useCtx();
  const [tab, setTab] = useState('profile');
  const { data: s, loading, error, reload } = useAsync(async () => {
    const snap = await getDoc(tdoc(iid, 'students', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }, [iid, id]);

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  if (!s) return <Alert kind="error">Student not found.</Alert>;
  return (
    <>
      <PageHeader title={s.name}>
        <Badge kind={s.status === 'ACTIVE' ? 'ok' : 'bad'}>{s.status}</Badge>
        <Link to="/students">Back to students</Link>
      </PageHeader>
      <Tabs
        value={tab} onChange={setTab}
        tabs={[{ value: 'profile', label: 'Profile' }, { value: 'enrollments', label: 'Enrollments' }, { value: 'documents', label: 'Documents' }]}
      />
      {tab === 'profile' && <Profile s={s} reload={reload} />}
      {tab === 'enrollments' && <Enrollments s={s} />}
      {tab === 'documents' && <FilePanel collection="students" ownerId={s.id} canUpload />}
    </>
  );
}

function Profile({ s, reload }) {
  const { iid, uid } = useCtx();
  const [editing, setEditing] = useState(false);
  const { busy, error, done, run } = useAction();
  const confirm = useConfirm();

  // One batch: the profile status, the login and a new audit entry. Changing only the status would leave the login working.
  const setActive = (active) =>
    run(async () => {
      const batch = writeBatch(db);
      const auditId = audit(batch, { iid, uid }, active ? 'STUDENT_REACTIVATED' : 'STUDENT_DEACTIVATED', 'students', s.id, {});
      batch.update(tdoc(iid, 'students', s.id), { status: active ? 'ACTIVE' : 'INACTIVE', updatedAt: serverTimestamp() });
      if (s.uid) batch.update(doc(db, 'users', s.uid), { active, updatedAt: serverTimestamp(), auditId });
      if (!active) {
        // Otherwise class registers and marks sheets keep listing them, and publishing waits for their marks.
        const current = await list(query(tcol(iid, 'enrollments'), where('studentId', '==', s.id), where('status', '==', 'ACTIVE')));
        current.forEach((en) => batch.update(tdoc(iid, 'enrollments', en.id), { status: 'WITHDRAWN', updatedAt: serverTimestamp() }));
      }
      await batch.commit();
      reload();
    }, active ? 'Student reactivated. Enroll them again if they are back in a class.' : 'Student deactivated. Their login is blocked and their current enrollments are withdrawn.');

  return (
    <div className="card">
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{done}</Alert>
      <Facts items={[['Enrollment number', s.enrollmentNumber], ['Email', s.email], ['Full name', s.name], ['Phone', s.phone], ['Admission date', s.admissionDate]]} />
      <div className="row">
        <Button variant="primary" disabled={busy} onClick={() => setEditing(true)}>Edit details</Button>
        {s.status === 'ACTIVE'
          ? <Button variant="danger" disabled={busy} onClick={() => confirm.ask({ title: `Deactivate ${s.name}?`, body: 'Their login is blocked and their current enrollments are withdrawn.', label: 'Deactivate' }, () => setActive(false))}>Deactivate</Button>
          : <Button disabled={busy} onClick={() => confirm.ask({ title: `Reactivate ${s.name}?`, body: 'Their login works again. You will need to enroll them in a class again.', label: 'Reactivate', danger: false }, () => setActive(true))}>Reactivate</Button>}
      </div>
      {!s.uid && <p className="muted">This student has no login.</p>}
      {confirm.dialog}
      {editing && <EditStudent s={s} onClose={(saved) => { setEditing(false); if (saved) reload(); }} />}
    </div>
  );
}

function EditStudent({ s, onClose }) {
  const { iid, uid } = useCtx();
  const { values, bind } = useForm({ name: s.name, phone: s.phone ?? '', admissionDate: s.admissionDate ?? '' });
  const { busy, error, run } = useAction();
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const name = values.name.trim();
      const batch = writeBatch(db);
      batch.update(tdoc(iid, 'students', s.id), { ...values, name, updatedAt: serverTimestamp() });
      if (name !== s.name) {
        // Class lists and the login keep their own copy of the name.
        const enrollments = await list(query(tcol(iid, 'enrollments'), where('studentId', '==', s.id)));
        enrollments.forEach((en) => batch.update(tdoc(iid, 'enrollments', en.id), { studentName: name, updatedAt: serverTimestamp() }));
        if (s.uid) {
          const auditId = audit(batch, { iid, uid }, 'STUDENT_RENAMED', 'students', s.id, { old: s.name, new: name });
          batch.update(doc(db, 'users', s.uid), { displayName: name, updatedAt: serverTimestamp(), auditId });
        }
      }
      await batch.commit();
      onClose(true);
    });
  };
  return (
    <Modal title="Edit student" onClose={() => onClose(false)}>
      <form onSubmit={save}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Full name" required {...bind('name')} />
          <Input label="Phone" {...bind('phone')} />
          <Input label="Admission date" type="date" {...bind('admissionDate')} />
        </div>
        <p className="muted">The enrollment number and email cannot be changed.</p>
        <div className="row">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Enrollments({ s }) {
  const { iid } = useCtx();
  const { data, loading, error, reload } = useAsync(async () => {
    const [enrollments, semesters, sections] = await Promise.all([
      list(query(tcol(iid, 'enrollments'), where('studentId', '==', s.id))),
      list(tcol(iid, 'semesters')),
      list(tcol(iid, 'sections')),
    ]);
    return { enrollments, semesters, sections, SE: byId(sections) };
  }, [iid, s.id]);
  const [enrolling, setEnrolling] = useState(false);
  const { busy, error: err, run } = useAction();
  const confirm = useConfirm();

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;

  const setStatus = (en, status) =>
    run(async () => {
      await updateDoc(tdoc(iid, 'enrollments', en.id), { status, updatedAt: serverTimestamp() });
      reload();
    });

  return (
    <>
      <Alert kind="error">{err}</Alert>
      <Table
        rows={data.enrollments}
        empty="Not enrolled in any semester yet."
        columns={[
          { key: 'semesterId', label: 'Semester', render: (e) => data.semesters.find((x) => x.id === e.semesterId)?.name ?? e.semesterId },
          { key: 'sectionId', label: 'Section', render: (e) => data.SE[e.sectionId]?.name ?? '—' },
          { key: 'status', label: 'Status', render: (e) => <Badge kind={e.status === 'ACTIVE' ? 'ok' : e.status === 'WITHDRAWN' ? 'bad' : ''}>{e.status}</Badge> },
        ]}
        actions={(e) => e.status === 'ACTIVE' && (
          <>
            <Button small disabled={busy} onClick={() => confirm.ask({ title: 'Mark this enrollment completed?', body: `${s.name} finishes this semester.`, label: 'Mark completed', danger: false }, () => setStatus(e, 'COMPLETED'))}>Mark completed</Button>{' '}
            <Button small variant="danger" disabled={busy} onClick={() => confirm.ask({ title: 'Withdraw this student?', body: `${s.name} is removed from this class register and marks sheets.`, label: 'Withdraw' }, () => setStatus(e, 'WITHDRAWN'))}>Withdraw</Button>
          </>
        )}
      />
      <div className="row" style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={() => setEnrolling(true)}>Enroll / change section</Button>
      </div>
      {confirm.dialog}
      {enrolling && <EnrollModal s={s} data={data} onClose={(saved) => { setEnrolling(false); if (saved) reload(); }} />}
    </>
  );
}

function EnrollModal({ s, data, onClose }) {
  const { iid } = useCtx();
  const { values, bind, set } = useForm({ semesterId: '', sectionId: '' });
  const { busy, error, run } = useAction();
  const submit = (ev) => {
    ev.preventDefault();
    run(async () => {
      const section = data.SE[values.sectionId];
      // ID = studentId_semesterId: one enrollment per period, and rules can find it with one lookup.
      await setDoc(tdoc(iid, 'enrollments', `${s.id}_${section.semesterId}`), {
        studentId: s.id, studentName: s.name, enrollmentNumber: s.enrollmentNumber, courseId: section.courseId,
        academicYearId: section.academicYearId, semesterId: section.semesterId, sectionId: section.id,
        status: 'ACTIVE', enrolledAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      onClose(true);
    });
  };
  return (
    <Modal title="Enroll or change section" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Select label="Semester" required options={toOptions(data.semesters)} value={values.semesterId}
            onChange={(v) => set((st) => ({ ...st, semesterId: v, sectionId: '' }))} />
          <Select label="Section" required options={toOptions(data.sections.filter((x) => x.semesterId === values.semesterId))} {...bind('sectionId')} />
        </div>
        <div className="row">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Enroll'}</Button>
        </div>
      </form>
    </Modal>
  );
}
