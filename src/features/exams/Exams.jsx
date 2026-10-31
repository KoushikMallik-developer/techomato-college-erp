import { useState } from 'react';
import { addDoc, getDoc, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { ROLES, tcol, tdoc } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { computeResult, toCsv } from '../../lib/calc';
import { byId, chunk, list } from '../../lib/data';
import { Alert, Badge, Button, Input, Loading, Modal, PageHeader, Select, Table, toOptions, downloadCsv, useAction, useAsync, useForm } from '../../components/ui';

export default function Exams() {
  const { role } = useCtx();
  if (role === ROLES.STUDENT) return <><PageHeader title="My results" /><MyResults /></>;
  if (role === ROLES.FACULTY) return <><PageHeader title="Marks entry" /><MarksEntry /></>;
  return <AdminExams />;
}

/* ---------------- admin: exams, subjects, publishing ---------------- */

function AdminExams() {
  const { iid } = useCtx();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState('');
  const { data, loading, error, reload } = useAsync(() => list(query(tcol(iid, 'exams'), orderBy('startDate', 'desc'))), [iid]);
  if (loading) return <Loading />;
  const exam = data?.find((e) => e.id === openId);
  return (
    <>
      <PageHeader title="Exams">
        <Button variant="primary" onClick={() => setCreating(true)}>Create exam</Button>
      </PageHeader>
      <Alert kind="error">{error?.message}</Alert>
      <Table
        rows={data ?? []}
        empty="No exams yet."
        columns={[
          { key: 'name', label: 'Exam' }, { key: 'type', label: 'Type' },
          { key: 'startDate', label: 'From' }, { key: 'endDate', label: 'To' },
          { key: 'status', label: 'Status', render: (e) => <Badge kind={e.status === 'PUBLISHED' ? 'ok' : 'warn'}>{e.status}</Badge> },
        ]}
        actions={(e) => <Button small onClick={() => setOpenId(e.id === openId ? '' : e.id)}>{e.id === openId ? 'Close' : 'Manage'}</Button>}
      />
      {exam && <ExamManager key={exam.id} exam={exam} onChange={reload} />}
      {creating && <CreateExam onClose={(saved) => { setCreating(false); if (saved) reload(); }} />}
    </>
  );
}

function CreateExam({ onClose }) {
  const { iid } = useCtx();
  const semesters = useAsync(() => list(tcol(iid, 'semesters')), [iid]);
  const { values, bind } = useForm({ name: '', type: '', semesterId: '', startDate: '', endDate: '' });
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const sem = byId(semesters.data)[values.semesterId];
      await addDoc(tcol(iid, 'exams'), {
        name: values.name.trim(), type: values.type.trim(), courseId: sem.courseId, semesterId: sem.id,
        academicYearId: sem.academicYearId, startDate: values.startDate, endDate: values.endDate,
        status: 'DRAFT', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      onClose(true);
    });
  };
  return (
    <Modal title="Create exam" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Name" required {...bind('name')} />
          <Input label="Type" hint="e.g. Mid-term, Final" required {...bind('type')} />
          <Select label="Semester" required options={toOptions(semesters.data ?? [])} {...bind('semesterId')} />
          <Input label="Start date" type="date" required {...bind('startDate')} />
          <Input label="End date" type="date" required {...bind('endDate')} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Button variant="primary" type="submit" disabled={busy}>Create</Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

async function loadExam(iid, exam) {
  const [examSubjects, subjects, enrollments, marks, semester] = await Promise.all([
    list(query(tcol(iid, 'examSubjects'), where('examId', '==', exam.id))),
    list(query(tcol(iid, 'subjects'), where('courseId', '==', exam.courseId))),
    list(query(tcol(iid, 'enrollments'), where('semesterId', '==', exam.semesterId))),
    list(query(tcol(iid, 'studentMarks'), where('examId', '==', exam.id))),
    getDoc(tdoc(iid, 'semesters', exam.semesterId)),
  ]);
  // Only subjects of this exam's semester can be papers: nobody teaches the others here.
  const ofSemester = subjects.filter((s) => s.semesterNumber === semester.data()?.number);
  return { examSubjects, subjects: ofSemester, enrollments: enrollments.filter((e) => e.status !== 'WITHDRAWN'), marks, S: byId(ofSemester) };
}

// Every enrolled student needs a marks record (or an absent mark) for every paper before publishing.
function checkExam(data) {
  const marksById = byId(data.marks);
  const gaps = [];
  const wrongSection = [];
  for (const en of data.enrollments) {
    for (const es of data.examSubjects) {
      const m = marksById[`${es.id}_${en.studentId}`];
      const who = `${en.enrollmentNumber} ${en.studentName}`;
      if (!m) gaps.push({ id: `${en.studentId}${es.id}`, student: who, paper: es.subjectName });
      else if (m.sectionId !== en.sectionId) wrongSection.push({ id: m.id, student: who, paper: es.subjectName });
    }
  }
  return { marksById, gaps, wrongSection };
}

function ExamManager({ exam, onChange }) {
  const { iid, uid } = useCtx();
  const draft = exam.status === 'DRAFT';
  const { data, loading, error, reload } = useAsync(() => loadExam(iid, exam), [exam.id, exam.status]);
  const { values, bind } = useForm({ subjectId: '', maxMarks: '', passMarks: '' });
  const action = useAction();

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;

  const chosen = new Set(data.examSubjects.map((x) => x.subjectId));
  const addSubject = (e) => {
    e.preventDefault();
    action.run(async () => {
      const s = data.S[values.subjectId];
      await setDoc(tdoc(iid, 'examSubjects', `${exam.id}_${s.id}`), {
        examId: exam.id, subjectId: s.id, subjectName: s.name, maxMarks: Number(values.maxMarks || s.maxMarks),
        passMarks: Number(values.passMarks || s.passMarks), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      reload();
    });
  };

  const { gaps, wrongSection } = checkExam(data);
  const resultCount = data.enrollments.length;

  const removePaper = (es) =>
    action.run(async () => {
      // Its marks go too: the paper's id is reused if the subject is added again, which would bring old marks back.
      // Read them fresh: a teacher may have saved more since this screen loaded.
      const marks = await list(query(tcol(iid, 'studentMarks'), where('examSubjectId', '==', es.id)));
      const warning = marks.length ? ` and the ${marks.length} marks already entered for it` : '';
      if (!window.confirm(`Remove ${es.subjectName}${warning}? This cannot be undone.`)) return;
      for (const part of chunk(marks, 450)) {
        const batch = writeBatch(db);
        part.forEach((m) => batch.delete(tdoc(iid, 'studentMarks', m.id)));
        await batch.commit();
      }
      const batch = writeBatch(db);
      audit(batch, { iid, uid }, 'PAPER_REMOVED', 'examSubjects', es.id, { subject: es.subjectName, marksDeleted: marks.length });
      batch.delete(tdoc(iid, 'examSubjects', es.id));
      await batch.commit();
      reload();
    });

  const publish = () =>
    action.run(async () => {
      // Re-read everything now: a teacher may have corrected marks since this screen loaded.
      const fresh = await loadExam(iid, exam);
      const check = checkExam(fresh);
      if (check.gaps.length || check.wrongSection.length) {
        reload();
        throw new Error('Marks changed since this screen loaded. Review the list below and try again.');
      }
      const marksById = check.marksById;
      const results = fresh.enrollments.map((en) => {
        const papers = fresh.examSubjects.map((es) => {
          const m = marksById[`${es.id}_${en.studentId}`];
          return { name: es.subjectName, marks: m.absent ? 0 : m.marks, absent: !!m.absent, maxMarks: es.maxMarks, passMarks: es.passMarks };
        });
        return { en, papers, ...computeResult(papers) };
      });
      // Draft results first, in chunks. Students cannot see them until the one write below.
      for (const part of chunk(results, 450)) {
        const batch = writeBatch(db);
        part.forEach((r) => batch.set(tdoc(iid, 'results', `${exam.id}_${r.en.studentId}`), {
          examId: exam.id, studentId: r.en.studentId, studentName: r.en.studentName, enrollmentNumber: r.en.enrollmentNumber,
          total: r.total, maxTotal: r.maxTotal, percentage: r.percentage, passed: r.passed, subjects: r.papers,
          computedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }));
        await batch.commit();
      }
      const batch = writeBatch(db);
      audit(batch, { iid, uid }, 'RESULTS_PUBLISHED', 'exams', exam.id, { students: results.length });
      batch.update(tdoc(iid, 'exams', exam.id), { status: 'PUBLISHED', updatedAt: serverTimestamp() });
      await batch.commit();
      onChange();
    }, 'Results published.');

  // Admin clean-up of a stray or wrong marks record while the exam is a draft; the right teacher re-enters it.
  const removeMark = (w) =>
    action.run(async () => {
      const batch = writeBatch(db);
      audit(batch, { iid, uid }, 'MARKS_RECORD_REMOVED', 'studentMarks', w.id, { student: w.student, paper: w.paper });
      batch.delete(tdoc(iid, 'studentMarks', w.id));
      await batch.commit();
      reload();
    });

  const unpublish = () =>
    action.run(async () => {
      const batch = writeBatch(db);
      audit(batch, { iid, uid }, 'RESULTS_UNPUBLISHED', 'exams', exam.id, {});
      batch.update(tdoc(iid, 'exams', exam.id), { status: 'DRAFT', updatedAt: serverTimestamp() });
      await batch.commit();
      onChange();
    }, 'Results hidden from students. Marks can be corrected now.');

  const exportCsv = () =>
    action.run(async () => {
      const rows = await list(query(tcol(iid, 'results'), where('examId', '==', exam.id)));
      downloadCsv(`${exam.name}-results.csv`, toCsv([
        ['Enrollment no.', 'Name', 'Total', 'Out of', 'Percentage', 'Result'],
        ...rows.map((r) => [r.enrollmentNumber, r.studentName, r.total, r.maxTotal, r.percentage, r.passed ? 'PASS' : 'FAIL']),
      ]));
    });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>{exam.name}</h2>
      <Alert kind="error">{action.error}</Alert>
      <Alert kind="ok">{action.done}</Alert>
      <h3>Papers</h3>
      <Table
        rows={data.examSubjects}
        empty="No papers yet."
        columns={[{ key: 'subjectName', label: 'Subject' }, { key: 'maxMarks', label: 'Max marks' }, { key: 'passMarks', label: 'Pass marks' }]}
        actions={draft ? (es) => <Button small variant="danger" disabled={action.busy} onClick={() => removePaper(es)}>
          {data.marks.some((m) => m.examSubjectId === es.id) ? 'Remove paper and its marks' : 'Remove paper'}
        </Button> : undefined}
      />
      {draft && (
        <form className="row" onSubmit={addSubject} style={{ margin: '12px 0' }}>
          <Select label="Add subject" required options={toOptions(data.subjects.filter((s) => !chosen.has(s.id)))} {...bind('subjectId')} />
          <Input label="Max marks" type="number" hint="blank = subject default" {...bind('maxMarks')} />
          <Input label="Pass marks" type="number" hint="blank = subject default" {...bind('passMarks')} />
          <Button type="submit" disabled={action.busy}>Add paper</Button>
        </form>
      )}
      <h3>Publishing</h3>
      {draft ? (
        <>
          {gaps.length > 0 && (
            <Alert kind="error">
              {gaps.length} marks are missing. Faculty must enter a mark (or mark the student absent) before publishing.
              <ul>{gaps.slice(0, 10).map((g) => <li key={g.id}>{g.student} — {g.paper}</li>)}</ul>
              {gaps.length > 10 && <p>…and {gaps.length - 10} more.</p>}
            </Alert>
          )}
          {wrongSection.length > 0 && (
            <Alert kind="error">
              {wrongSection.length} marks were entered for a different section than the student's enrollment. Remove each
              one; the teacher of that section then enters it again.
              <ul>
                {wrongSection.slice(0, 10).map((w) => (
                  <li key={w.id}>
                    {w.student} — {w.paper}{' '}
                    <Button small variant="danger" disabled={action.busy} onClick={() => removeMark(w)}>Remove record</Button>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <p className="muted">Publishing writes {resultCount} result records, against the shared daily free quota. Avoid doing it on a heavy marks-entry day.</p>
          <Button variant="primary" onClick={publish}
            disabled={action.busy || gaps.length > 0 || wrongSection.length > 0 || !data.examSubjects.length || !resultCount}>
            {action.busy ? 'Publishing…' : 'Publish results'}
          </Button>
        </>
      ) : (
        <div className="row">
          <Button onClick={exportCsv} disabled={action.busy}>Export results CSV</Button>
          <Button variant="danger" onClick={unpublish} disabled={action.busy}>Unpublish to correct marks</Button>
        </div>
      )}
    </div>
  );
}

/* ---------------- faculty: marks entry ---------------- */

function MarksEntry() {
  const { iid, uid, profile } = useCtx();
  const [examId, setExamId] = useState('');
  const [paperId, setPaperId] = useState('');
  const base = useAsync(async () => {
    const [exams, assignments] = await Promise.all([
      list(query(tcol(iid, 'exams'), where('status', '==', 'DRAFT'))),
      list(query(tcol(iid, 'teachingAssignments'), where('facultyId', '==', profile.facultyId), where('active', '==', true))),
    ]);
    return { exams, assignments };
  }, [iid]);
  const papers = useAsync(
    () => (examId ? list(query(tcol(iid, 'examSubjects'), where('examId', '==', examId))) : Promise.resolve([])),
    [iid, examId],
  );
  if (base.loading) return <Loading />;
  const exam = base.data.exams.find((e) => e.id === examId);
  // Only papers the teacher actually teaches in that exam's semester.
  const mine = (papers.data ?? []).flatMap((p) => {
    const a = base.data.assignments.find((x) => x.subjectId === p.subjectId && x.semesterId === exam?.semesterId);
    return a ? [{ paper: p, a }] : [];
  });
  const picked = mine.find((m) => m.paper.id === paperId);
  return (
    <>
      <Alert kind="error">{base.error?.message || papers.error?.message}</Alert>
      <div className="row" style={{ marginBottom: 12 }}>
        <Select label="Exam (open for marks)" value={examId} onChange={(v) => { setExamId(v); setPaperId(''); }} options={toOptions(base.data.exams)} />
        <Select label="Paper" value={paperId} onChange={setPaperId} options={mine.map((m) => ({ value: m.paper.id, label: `${m.paper.subjectName} (max ${m.paper.maxMarks})` }))} />
      </div>
      {examId && !papers.loading && mine.length === 0 && <Alert kind="info">This exam has no paper for a class you teach.</Alert>}
      {picked && <MarksSheet key={picked.paper.id} exam={exam} paper={picked.paper} a={picked.a} ctx={{ iid, uid }} />}
    </>
  );
}

function MarksSheet({ exam, paper, a, ctx }) {
  const { data, loading, error, reload } = useAsync(async () => {
    const [enrollments, marks] = await Promise.all([
      list(query(tcol(ctx.iid, 'enrollments'), where('semesterId', '==', a.semesterId), where('sectionId', '==', a.sectionId))),
      list(query(tcol(ctx.iid, 'studentMarks'), where('examSubjectId', '==', paper.id), where('enteredBy', '==', ctx.uid))),
    ]);
    return {
      roster: enrollments.filter((e) => e.status === 'ACTIVE').sort((x, y) => x.enrollmentNumber.localeCompare(y.enrollmentNumber)),
      saved: byId(marks.map((m) => ({ ...m, id: m.studentId }))),
    };
  }, [paper.id]);
  const [edits, setEdits] = useState({});
  const { busy, error: err, done, run } = useAction();

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  const valueOf = (s) => edits[s.studentId] ?? (data.saved[s.studentId] ? { marks: String(data.saved[s.studentId].marks), absent: !!data.saved[s.studentId].absent } : { marks: '', absent: false });

  const save = () =>
    run(async () => {
      const batch = writeBatch(db);
      let n = 0;
      for (const s of data.roster) {
        if (!edits[s.studentId]) continue;
        const v = edits[s.studentId];
        const marks = v.absent ? 0 : Number(v.marks);
        if (!v.absent && (v.marks === '' || Number.isNaN(marks) || marks < 0 || marks > paper.maxMarks)) {
          throw new Error(`${s.studentName}: enter marks from 0 to ${paper.maxMarks}, or tick Absent.`);
        }
        const ref = tdoc(ctx.iid, 'studentMarks', `${paper.id}_${s.studentId}`);
        if (data.saved[s.studentId]) {
          batch.update(ref, { marks, absent: !!v.absent, updatedAt: serverTimestamp() });
        } else {
          batch.set(ref, {
            examId: exam.id, examSubjectId: paper.id, assignmentId: a.id, sectionId: a.sectionId, studentId: s.studentId,
            marks, absent: !!v.absent, enteredBy: ctx.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
        }
        n++;
      }
      if (!n) throw new Error('Nothing changed.');
      await batch.commit();
      setEdits({});
      reload();
    }, 'Marks saved.');

  return (
    <div className="card">
      <Alert kind="error">{err}</Alert>
      <Alert kind="ok">{done}</Alert>
      <Table
        rows={data.roster.map((s) => ({ ...s, id: s.studentId }))}
        empty="No active students in this section."
        columns={[
          { key: 'enrollmentNumber', label: 'Enrollment no.' },
          { key: 'studentName', label: 'Name' },
          { key: 'marks', label: `Marks (max ${paper.maxMarks})`, render: (s) => (
            <input type="number" min="0" max={paper.maxMarks} aria-label={`Marks for ${s.studentName}`} style={{ width: 100 }}
              disabled={valueOf(s).absent} value={valueOf(s).marks}
              onChange={(e) => setEdits({ ...edits, [s.studentId]: { ...valueOf(s), marks: e.target.value } })} />
          ) },
          { key: 'absent', label: 'Absent', render: (s) => (
            <input type="checkbox" aria-label={`${s.studentName} absent`} style={{ width: 20, minHeight: 20 }} checked={valueOf(s).absent}
              onChange={(e) => setEdits({ ...edits, [s.studentId]: { ...valueOf(s), absent: e.target.checked } })} />
          ) },
        ]}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save marks'}</Button>
      </div>
    </div>
  );
}

/* ---------------- student: published results ---------------- */

function MyResults() {
  const { iid, profile } = useCtx();
  // Rules do not filter: a query that could touch an unpublished result is rejected as a whole.
  // So read the published exams first, then fetch this student's result for each by its ID.
  const { data, loading, error } = useAsync(async () => {
    const exams = await list(query(tcol(iid, 'exams'), where('status', '==', 'PUBLISHED')));
    const snaps = await Promise.all(exams.map((e) => getDoc(tdoc(iid, 'results', `${e.id}_${profile.studentId}`))));
    return snaps.flatMap((s, i) => (s.exists() ? [{ id: s.id, ...s.data(), exam: exams[i] }] : []));
  }, [iid]);
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  if (!data.length) return <Alert kind="info">No results have been published yet.</Alert>;
  return (
    <>
      <div className="row"><Button onClick={() => window.print()}>Print / save as PDF</Button></div>
      {data.map((r) => (
        <div className="card" key={r.id} style={{ marginTop: 12 }}>
          <h2>{r.exam.name}</h2>
          <p>
            <strong>{r.total} / {r.maxTotal}</strong> · {r.percentage}% · <Badge kind={r.passed ? 'ok' : 'bad'}>{r.passed ? 'PASS' : 'FAIL'}</Badge>
          </p>
          <Table
            rows={r.subjects.map((s, i) => ({ ...s, id: i }))}
            columns={[
              { key: 'name', label: 'Subject' },
              { key: 'marks', label: 'Marks', render: (s) => (s.absent ? 'Absent' : s.marks) },
              { key: 'maxMarks', label: 'Max' }, { key: 'passMarks', label: 'Pass' },
            ]}
          />
        </div>
      ))}
    </>
  );
}
