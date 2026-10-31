import { useState } from 'react';
import { query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { ROLES, tcol, tdoc } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { STATUSES, attendanceBySubject, groupByCost, percent, planAttendanceWrites, recordKey, toCsv } from '../../lib/calc';
import { byId, chunk, list } from '../../lib/data';
import { Alert, Badge, Button, Input, Loading, PageHeader, Select, Table, Tabs, downloadCsv, useAction, useAsync } from '../../components/ui';

export default function Attendance() {
  const { role } = useCtx();
  if (role === ROLES.STUDENT) return <><PageHeader title="My attendance" /><MyAttendance /></>;
  if (role === ROLES.FACULTY) return <><PageHeader title="Attendance" /><ClassRegister /></>;
  return <AdminAttendance />;
}

function AdminAttendance() {
  const [tab, setTab] = useState('reports');
  return (
    <>
      <PageHeader title="Attendance" />
      <Tabs value={tab} onChange={setTab}
        tabs={[{ value: 'reports', label: 'Class reports' }, { value: 'faculty', label: 'Faculty attendance' }]} />
      {tab === 'reports' ? <Reports /> : <FacultyRegister />}
    </>
  );
}

function StatusButtons({ value, onChange }) {
  return (
    <div className="status-group" role="group">
      {STATUSES.map((s) => (
        <button key={s} type="button" className={s} aria-pressed={value === s} onClick={() => onChange(s)}>
          {s[0] + s.slice(1).toLowerCase()}
        </button>
      ))}
    </div>
  );
}

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

function ClassRegister() {
  const { iid, uid, profile, today } = useCtx();
  const [assignmentId, setAssignmentId] = useState('');
  const [date, setDate] = useState(today());
  const [period, setPeriod] = useState('1');
  const assignments = useAsync(
    () => list(query(tcol(iid, 'teachingAssignments'), where('facultyId', '==', profile.facultyId), where('active', '==', true))),
    [iid],
  );
  if (assignments.loading) return <Loading />;
  const a = assignments.data.find((x) => x.id === assignmentId);
  return (
    <>
      <Alert kind="error">{assignments.error?.message}</Alert>
      <div className="row" style={{ marginBottom: 12 }}>
        <Select label="Class" value={assignmentId} onChange={setAssignmentId}
          options={assignments.data.map((x) => ({ value: x.id, label: x.subjectName }))} />
        <Input label="Date" type="date" max={today()} value={date} onChange={setDate} />
        <Select label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: String(p), label: String(p) }))} />
      </div>
      {assignments.data.length === 0 && <Alert kind="info">You have no active classes. Ask an admin to assign you to one.</Alert>}
      {a && date && <Register key={`${a.id}${date}${period}`} a={a} date={date} period={Number(period)} ctx={{ iid, uid }} />}
    </>
  );
}

function Register({ a, date, period, ctx }) {
  const key = recordKey(date, period);
  const { data, loading, error, reload } = useAsync(async () => {
    const [enrollments, saved] = await Promise.all([
      list(query(tcol(ctx.iid, 'enrollments'), where('semesterId', '==', a.semesterId), where('sectionId', '==', a.sectionId))),
      list(query(tcol(ctx.iid, 'studentAttendance'), where('assignmentId', '==', a.id), where('facultyId', '==', a.facultyId))),
    ]);
    const roster = enrollments.filter((e) => e.status === 'ACTIVE').sort((x, y) => x.enrollmentNumber.localeCompare(y.enrollmentNumber));
    return { roster, saved: byId(saved.map((d) => ({ ...d, id: d.studentId }))) };
  }, [a.id, key]);
  const [picked, setPicked] = useState({});
  const { busy, error: err, done, run } = useAction();

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  const earlier = (s) => data.saved[s.studentId]?.records?.[key];
  const statusOf = (s) => picked[s.studentId] ?? earlier(s) ?? 'PRESENT';

  const save = () =>
    run(async () => {
      const writes = planAttendanceWrites(data.roster, data.saved, key, statusOf).map(({ student: s, next, kind, old }) => {
        const ref = tdoc(ctx.iid, 'studentAttendance', `${s.studentId}_${a.id}`);
        const stamp = { updatedBy: ctx.uid, updatedAt: serverTimestamp() };
        // cost = rule lookups: a new record checks the enrollment (1); an edit checks its audit entry (exists + existsAfter, 2).
        if (kind === 'create') {
          return {
            cost: 1,
            run: (b) => b.set(ref, {
              studentId: s.studentId, subjectId: a.subjectId, semesterId: a.semesterId, sectionId: a.sectionId,
              assignmentId: a.id, facultyId: a.facultyId, records: { [key]: next }, createdAt: serverTimestamp(), ...stamp,
            }),
          };
        }
        if (kind === 'add') return { cost: 0, run: (b) => b.update(ref, { [`records.${key}`]: next, ...stamp }) };
        // Changing an existing mark: each edit gets its own new audit entry with the old and new value.
        return {
          cost: 2,
          run: (b) => {
            const auditId = audit(b, ctx, 'ATTENDANCE_EDIT', 'studentAttendance', ref.id, { key, old, new: next });
            b.update(ref, { [`records.${key}`]: next, ...stamp, auditId });
          },
        };
      });
      const counts = { PRESENT: 0, ABSENT: 0, LEAVE: 0 };
      data.roster.forEach((s) => counts[statusOf(s)]++);
      const session = {
        assignmentId: a.id, sectionId: a.sectionId, subjectId: a.subjectId, facultyId: a.facultyId, date, period,
        presentCount: counts.PRESENT, absentCount: counts.ABSENT, leaveCount: counts.LEAVE, updatedAt: serverTimestamp(),
      };
      // The rules allow about 20 lookups per batch and 3 are always used (user, college, assignment): stay at 14.
      const groups = groupByCost(writes, 14);
      for (let i = 0; i < groups.length; i++) {
        const batch = writeBatch(db);
        groups[i].forEach((w) => w.run(batch));
        if (i === groups.length - 1) batch.set(tdoc(ctx.iid, 'classSessions', `${a.id}_${date}_${period}`), session);
        await batch.commit();
      }
      if (!groups.length) {
        const batch = writeBatch(db);
        batch.set(tdoc(ctx.iid, 'classSessions', `${a.id}_${date}_${period}`), session);
        await batch.commit();
      }
      setPicked({});
      reload();
    }, 'Attendance saved.');

  return (
    <div className="card">
      <Alert kind="error">{err}</Alert>
      <Alert kind="ok">{done}</Alert>
      {data.roster.length === 0 ? <p className="muted">No active students are enrolled in this section.</p> : (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <Button small onClick={() => setPicked(Object.fromEntries(data.roster.map((s) => [s.studentId, 'PRESENT'])))}>All present</Button>
            <span className="muted">Students already marked for this period show "saved". Changing a saved mark is logged.</span>
          </div>
          <Table
            rows={data.roster.map((s) => ({ ...s, id: s.studentId }))}
            columns={[
              { key: 'enrollmentNumber', label: 'Enrollment no.' },
              { key: 'studentName', label: 'Name' },
              { key: 'status', label: 'Status', render: (s) => <StatusButtons value={statusOf(s)} onChange={(v) => setPicked({ ...picked, [s.studentId]: v })} /> },
              { key: 'saved', label: '', render: (s) => earlier(s) && <Badge>saved</Badge> },
            ]}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save attendance'}</Button>
          </div>
        </>
      )}
    </div>
  );
}

function FacultyRegister() {
  const { iid, uid, today } = useCtx();
  const [date, setDate] = useState(today());
  const { data, loading, error, reload } = useAsync(async () => {
    const [faculty, saved] = await Promise.all([
      list(query(tcol(iid, 'faculty'), where('status', '==', 'ACTIVE'))),
      list(query(tcol(iid, 'facultyAttendance'), where('date', '==', date))),
    ]);
    return { faculty, saved: byId(saved.map((d) => ({ ...d, id: d.facultyId }))) };
  }, [iid, date]);
  const [picked, setPicked] = useState({});
  const { busy, error: err, done, run } = useAction();

  const save = () =>
    run(async () => {
      const batch = writeBatch(db);
      for (const [facultyId, status] of Object.entries(picked)) {
        batch.set(tdoc(iid, 'facultyAttendance', `${facultyId}_${date}`), {
          facultyId, date, status, markedBy: uid, updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setPicked({});
      reload();
    }, 'Saved.');

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Input label="Date" type="date" max={today()} value={date} onChange={(v) => { setDate(v); setPicked({}); }} />
      </div>
      <Alert kind="error">{error?.message || err}</Alert>
      <Alert kind="ok">{done}</Alert>
      {loading ? <Loading /> : (
        <>
          <Table
            rows={data.faculty}
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'employeeCode', label: 'Code' },
              { key: 'status', label: 'Status', render: (f) => (
                <StatusButtons value={picked[f.id] ?? data.saved[f.id]?.status} onChange={(v) => setPicked({ ...picked, [f.id]: v })} />
              ) },
            ]}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="primary" disabled={busy || !Object.keys(picked).length} onClick={save}>Save faculty attendance</Button>
          </div>
        </>
      )}
    </>
  );
}

function Reports() {
  const { iid } = useCtx();
  const [assignmentId, setAssignmentId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [find, setFind] = useState('');
  const assignments = useAsync(() => list(tcol(iid, 'teachingAssignments')), [iid]);
  const report = useAsync(async () => {
    if (!assignmentId) return null;
    const a = assignments.data.find((x) => x.id === assignmentId);
    const [enrollments, docs] = await Promise.all([
      list(query(tcol(iid, 'enrollments'), where('semesterId', '==', a.semesterId), where('sectionId', '==', a.sectionId))),
      list(query(tcol(iid, 'studentAttendance'), where('assignmentId', '==', assignmentId))),
    ]);
    return { enrollments, docs: byId(docs.map((d) => ({ ...d, id: d.studentId }))) };
  }, [assignmentId]);

  const inRange = (k) => {
    const d = k.slice(1, 9); // dYYYYMMDD_p
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    return (!from || iso >= from) && (!to || iso <= to);
  };
  const rows = (report.data?.enrollments ?? [])
    .map((e) => {
      const d = report.data.docs[e.studentId];
      const filtered = { ...d, records: Object.fromEntries(Object.entries(d?.records ?? {}).filter(([k]) => inRange(k))) };
      const t = Object.values(attendanceBySubject([filtered]))[0] ?? { present: 0, absent: 0, leave: 0, percent: null };
      return { id: e.studentId, enrollmentNumber: e.enrollmentNumber, name: e.studentName, ...t };
    })
    .filter((r) => !find || `${r.enrollmentNumber} ${r.name}`.toLowerCase().includes(find.toLowerCase()));

  const csv = () =>
    downloadCsv('attendance.csv', toCsv([
      ['Enrollment no.', 'Name', 'Present', 'Absent', 'Leave', 'Percent'],
      ...rows.map((r) => [r.enrollmentNumber, r.name, r.present, r.absent, r.leave, r.percent ?? '']),
    ]));

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Select label="Class (subject and section)" value={assignmentId} onChange={setAssignmentId}
          options={(assignments.data ?? []).map((a) => ({ value: a.id, label: `${a.subjectName} — ${a.facultyName}${a.active ? '' : ' (ended)'}` }))} />
        <Input label="From" type="date" value={from} onChange={setFrom} />
        <Input label="To" type="date" value={to} onChange={setTo} />
        <Input label="Find student" value={find} onChange={setFind} />
        <Button onClick={csv} disabled={!rows.length}>Export CSV</Button>
      </div>
      <Alert kind="error">{report.error?.message}</Alert>
      {report.loading && assignmentId ? <Loading /> : (
        <Table
          rows={rows}
          empty={assignmentId ? 'No students.' : 'Choose a class to see its report.'}
          columns={[
            { key: 'enrollmentNumber', label: 'Enrollment no.' }, { key: 'name', label: 'Name' },
            { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' }, { key: 'leave', label: 'Leave' },
            { key: 'percent', label: '%', render: (r) => (r.percent === null ? '—' : <Badge kind={r.percent < 75 ? 'bad' : 'ok'}>{r.percent}%</Badge>) },
          ]}
        />
      )}
      <p className="muted">Percentage = present ÷ (present + absent). Leave is not counted.</p>
    </>
  );
}

function MyAttendance() {
  const { iid, profile } = useCtx();
  const { data, loading, error } = useAsync(async () => {
    const [docs, subjects] = await Promise.all([
      list(query(tcol(iid, 'studentAttendance'), where('studentId', '==', profile.studentId))),
      list(tcol(iid, 'subjects')),
    ]);
    const S = byId(subjects);
    return Object.entries(attendanceBySubject(docs)).map(([id, t]) => ({ id, subject: S[id]?.name ?? id, ...t }));
  }, [iid]);
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  const present = data.reduce((n, r) => n + r.present, 0);
  const absent = data.reduce((n, r) => n + r.absent, 0);
  const overall = percent(present, absent);
  return (
    <>
      <div className="card"><div className="stat">{overall === null ? '—' : `${overall}%`}</div><div className="stat-label">Overall</div></div>
      <Table
        rows={data}
        empty="No attendance recorded yet."
        columns={[
          { key: 'subject', label: 'Subject' }, { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' },
          { key: 'leave', label: 'Leave' },
          { key: 'percent', label: '%', render: (r) => (r.percent === null ? '—' : <Badge kind={r.percent < 75 ? 'bad' : 'ok'}>{r.percent}%</Badge>) },
        ]}
      />
      <p className="muted">Percentage = present ÷ (present + absent). Leave is not counted.</p>
    </>
  );
}
