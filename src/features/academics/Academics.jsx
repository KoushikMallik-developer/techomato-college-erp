import { useState } from 'react';
import { doc, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol, tdoc } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { byId, list } from '../../lib/data';
import { Alert, Badge, Button, Loading, Modal, PageHeader, Select, Table, Tabs, toOptions, useAction, useAsync, useForm } from '../../components/ui';
import CrudPage from './CrudPage';

const STATUS = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];
const ref = (collection, label = 'name') => ({ collection, label });

const CONFIGS = {
  departments: {
    collection: 'departments', singular: 'department', columns: ['name', 'code', 'status'],
    fields: [
      { name: 'name', label: 'Name' }, { name: 'code', label: 'Code' },
      { name: 'status', label: 'Status', options: STATUS, default: 'ACTIVE' },
    ],
  },
  courses: {
    collection: 'courses', singular: 'course', columns: ['name', 'code', 'departmentId', 'duration', 'status'],
    fields: [
      { name: 'name', label: 'Name' }, { name: 'code', label: 'Code' },
      { name: 'departmentId', label: 'Department', ref: ref('departments') },
      { name: 'duration', label: 'Duration (semesters)', type: 'number' },
      { name: 'status', label: 'Status', options: STATUS, default: 'ACTIVE' },
    ],
  },
  subjects: {
    collection: 'subjects', singular: 'subject', columns: ['name', 'code', 'courseId', 'semesterNumber', 'maxMarks', 'passMarks'],
    fields: [
      { name: 'name', label: 'Name' }, { name: 'code', label: 'Code' },
      { name: 'courseId', label: 'Course', ref: ref('courses') },
      { name: 'semesterNumber', label: 'Semester number', type: 'number' },
      { name: 'maxMarks', label: 'Default max marks', type: 'number' },
      { name: 'passMarks', label: 'Default pass marks', type: 'number' },
    ],
  },
  academicYears: {
    collection: 'academicYears', singular: 'academic year', orderBy: 'label', columns: ['label', 'startDate', 'endDate', 'active'],
    fields: [
      { name: 'label', label: 'Label', hint: 'e.g. 2026-27' },
      { name: 'startDate', label: 'Start date', type: 'date' }, { name: 'endDate', label: 'End date', type: 'date' },
      { name: 'active', label: 'Current year', type: 'bool' },
    ],
  },
  semesters: {
    collection: 'semesters', singular: 'semester', columns: ['name', 'courseId', 'academicYearId', 'number', 'startDate', 'endDate'],
    fields: [
      { name: 'name', label: 'Name', hint: 'e.g. BSc Sem 1 2026-27' },
      { name: 'courseId', label: 'Course', ref: ref('courses') },
      { name: 'academicYearId', label: 'Academic year', ref: ref('academicYears', 'label') },
      { name: 'number', label: 'Semester number', type: 'number' },
      { name: 'startDate', label: 'Start date', type: 'date' }, { name: 'endDate', label: 'End date', type: 'date' },
    ],
  },
  sections: {
    collection: 'sections', singular: 'section', columns: ['name', 'semesterId', 'room'],
    fields: [
      { name: 'name', label: 'Section name', hint: 'e.g. Sem 1 - A' },
      { name: 'semesterId', label: 'Semester', ref: { collection: 'semesters', label: 'name' }, copy: { courseId: 'courseId', academicYearId: 'academicYearId' } },
      { name: 'room', label: 'Default room', required: false },
    ],
  },
};

const TABS = [
  ['departments', 'Departments'], ['courses', 'Courses'], ['subjects', 'Subjects'], ['academicYears', 'Academic years'],
  ['semesters', 'Semesters'], ['sections', 'Sections'], ['assignments', 'Teaching assignments'],
];

export default function Academics() {
  const [tab, setTab] = useState('departments');
  return (
    <>
      <PageHeader title="Academics" />
      <Tabs tabs={TABS.map(([value, label]) => ({ value, label }))} value={tab} onChange={setTab} />
      {tab === 'assignments' ? <Assignments /> : <CrudPage key={tab} config={CONFIGS[tab]} />}
    </>
  );
}

// A teacher is never edited on an assignment: a replacement creates a new one and deactivates the old one,
// so the old teacher loses write access and the new teacher gets their own attendance documents.
function Assignments() {
  const { iid, uid } = useCtx();
  const [mode, setMode] = useState(null); // { replace?: assignment }
  const { data, loading, error, reload } = useAsync(async () => {
    const [assignments, faculty, subjects, sections] = await Promise.all([
      list(query(tcol(iid, 'teachingAssignments'), orderBy('createdAt', 'desc'))),
      list(query(tcol(iid, 'faculty'), where('status', '==', 'ACTIVE'))),
      list(tcol(iid, 'subjects')),
      list(tcol(iid, 'sections')),
    ]);
    return { assignments, faculty, subjects, sections, S: byId(subjects), SE: byId(sections) };
  }, [iid]);
  const action = useAction();

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;

  const deactivate = (a) =>
    action.run(async () => {
      const batch = writeBatch(db);
      audit(batch, { iid, uid }, 'ASSIGNMENT_DEACTIVATED', 'teachingAssignments', a.id, {});
      batch.update(tdoc(iid, 'teachingAssignments', a.id), { active: false, updatedAt: serverTimestamp() });
      await batch.commit();
      reload();
    });

  return (
    <>
      <Alert kind="error">{action.error}</Alert>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button variant="primary" onClick={() => setMode({})}>Assign a teacher</Button>
      </div>
      <Table
        rows={data.assignments}
        columns={[
          { key: 'subject', label: 'Subject', render: (a) => data.S[a.subjectId]?.name ?? a.subjectName ?? '—' },
          { key: 'section', label: 'Section', render: (a) => data.SE[a.sectionId]?.name ?? '—' },
          { key: 'facultyName', label: 'Teacher' },
          { key: 'active', label: 'Status', render: (a) => <Badge kind={a.active ? 'ok' : ''}>{a.active ? 'Active' : 'Replaced / ended'}</Badge> },
        ]}
        actions={(a) => a.active && (
          <>
            <Button small onClick={() => setMode({ replace: a })}>Replace teacher</Button>{' '}
            <Button small variant="danger" disabled={action.busy} onClick={() => deactivate(a)}>End</Button>
          </>
        )}
      />
      {mode && <AssignForm data={data} replace={mode.replace} onClose={(saved) => { setMode(null); if (saved) reload(); }} />}
    </>
  );
}

function AssignForm({ data, replace, onClose }) {
  const { iid, uid } = useCtx();
  const { values, bind } = useForm({
    facultyId: '', subjectId: replace?.subjectId ?? '', sectionId: replace?.sectionId ?? '',
  });
  const { busy, error, run } = useAction();
  const F = byId(data.faculty);

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (replace && values.facultyId === replace.facultyId) throw new Error('Choose a different teacher.');
      const section = data.SE[values.sectionId];
      const faculty = F[values.facultyId];
      const subject = data.S[values.subjectId];
      const batch = writeBatch(db);
      const ref = doc(tcol(iid, 'teachingAssignments'));
      batch.set(ref, {
        facultyId: faculty.id, facultyName: faculty.name, subjectId: subject.id, subjectName: subject.name,
        sectionId: section.id, semesterId: section.semesterId, academicYearId: section.academicYearId,
        active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      if (replace) {
        batch.update(tdoc(iid, 'teachingAssignments', replace.id), { active: false, updatedAt: serverTimestamp() });
        // Move this class's timetable slots to the new teacher: swap the faculty lock and re-point the slot.
        const slots = await list(query(tcol(iid, 'timetableSlots'), where('assignmentId', '==', replace.id)));
        for (const s of slots) {
          batch.delete(tdoc(iid, 'timetableLocks', `faculty_${s.facultyId}_${s.dayOfWeek}_${s.period}`));
          batch.set(tdoc(iid, 'timetableLocks', `faculty_${faculty.id}_${s.dayOfWeek}_${s.period}`), {
            slotId: s.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
          batch.update(tdoc(iid, 'timetableSlots', s.id), {
            facultyId: faculty.id, facultyName: faculty.name, assignmentId: ref.id, updatedAt: serverTimestamp(),
          });
        }
      }
      audit(batch, { iid, uid }, replace ? 'ASSIGNMENT_REPLACED' : 'ASSIGNMENT_CREATED', 'teachingAssignments', ref.id, {
        facultyId: faculty.id, replaced: replace?.id ?? null,
      });
      try {
        await batch.commit();
      } catch (err) {
        if (err.code === 'permission-denied' && replace) {
          throw new Error('The new teacher is already booked in one of this class timetable periods. Change that slot first.');
        }
        throw err;
      }
      onClose(true);
    });
  };

  return (
    <Modal title={replace ? 'Replace teacher' : 'Assign a teacher'} onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        {replace && <Alert kind="info">The current teacher loses write access to this class straight away. The new teacher starts with an empty register; earlier attendance stays with the old assignment. This class's timetable slots move to the new teacher.</Alert>}
        <div className="form-grid">
          <Select label="Teacher" required options={toOptions(data.faculty)} {...bind('facultyId')} />
          <Select label="Subject" required disabled={!!replace} options={toOptions(data.subjects)} {...bind('subjectId')} />
          <Select label="Section" required disabled={!!replace} options={toOptions(data.sections)} {...bind('sectionId')} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
