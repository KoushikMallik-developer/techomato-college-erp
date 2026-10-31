import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol, tdoc } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { byId, list } from '../../lib/data';
import FilePanel from '../../components/FilePanel';
import { Alert, Badge, Button, Input, Loading, PageHeader, Select, Table, Tabs, toOptions, useAction, useAsync, useForm } from '../../components/ui';

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
  const { values, bind } = useForm({ name: s.name, phone: s.phone ?? '', admissionDate: s.admissionDate ?? '' });
  const { busy, error, done, run } = useAction();

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
      reload();
    }, 'Saved.');
  };

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
    <form className="card" onSubmit={save}>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{done}</Alert>
      <div className="form-grid">
        <Input label="Enrollment number" value={s.enrollmentNumber} onChange={() => {}} readOnly hint="Cannot be changed" />
        <Input label="Email" value={s.email} onChange={() => {}} readOnly hint="Set at creation" />
        <Input label="Full name" required {...bind('name')} />
        <Input label="Phone" {...bind('phone')} />
        <Input label="Admission date" type="date" {...bind('admissionDate')} />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <Button variant="primary" type="submit" disabled={busy}>Save</Button>
        {s.status === 'ACTIVE'
          ? <Button variant="danger" disabled={busy} onClick={() => setActive(false)}>Deactivate</Button>
          : <Button disabled={busy} onClick={() => setActive(true)}>Reactivate</Button>}
      </div>
      {!s.uid && <p className="muted">This student has no login.</p>}
    </form>
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
  const { values, bind } = useForm({ semesterId: '', sectionId: '' });
  const { busy, error: err, run } = useAction();

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;

  const enroll = (e) => {
    e.preventDefault();
    run(async () => {
      const section = data.SE[values.sectionId];
      // ID = studentId_semesterId: one enrollment per period, and rules can find it with one lookup.
      await setDoc(tdoc(iid, 'enrollments', `${s.id}_${section.semesterId}`), {
        studentId: s.id, studentName: s.name, enrollmentNumber: s.enrollmentNumber, courseId: section.courseId,
        academicYearId: section.academicYearId, semesterId: section.semesterId, sectionId: section.id,
        status: 'ACTIVE', enrolledAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      reload();
    });
  };
  const setStatus = (en, status) =>
    run(async () => {
      await updateDoc(tdoc(iid, 'enrollments', en.id), { status, updatedAt: serverTimestamp() });
      reload();
    });

  const sectionsOfSemester = data.sections.filter((x) => x.semesterId === values.semesterId);
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
            <Button small onClick={() => setStatus(e, 'COMPLETED')} disabled={busy}>Mark completed</Button>{' '}
            <Button small variant="danger" onClick={() => setStatus(e, 'WITHDRAWN')} disabled={busy}>Withdraw</Button>
          </>
        )}
      />
      <form className="card row" onSubmit={enroll} style={{ marginTop: 16 }}>
        <Select label="Semester" required options={toOptions(data.semesters)} value={values.semesterId}
          onChange={(v) => { bind('semesterId').onChange(v); bind('sectionId').onChange(''); }} />
        <Select label="Section" required options={toOptions(sectionsOfSemester)} {...bind('sectionId')} />
        <Button variant="primary" type="submit" disabled={busy}>Enroll / change section</Button>
      </form>
    </>
  );
}
