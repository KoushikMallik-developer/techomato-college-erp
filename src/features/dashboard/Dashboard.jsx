import { getCountFromServer, limit, orderBy, query, where } from 'firebase/firestore';
import { useCtx } from '../../app/AuthProvider';
import { tcol, isAdminRole, ROLES } from '../../lib/tenant';
import { attendanceBySubject, percent } from '../../lib/calc';
import { list } from '../../lib/data';
import { Alert, Badge, Loading, PageHeader, useAsync } from '../../components/ui';
import { AnnouncementList } from '../announcements/Announcements';

const count = async (q) => (await getCountFromServer(q)).data().count;

function AdminStats() {
  const { iid, today } = useCtx();
  const { data, loading, error } = useAsync(async () => {
    const [students, faculty, departments, courses, sessions] = await Promise.all([
      count(query(tcol(iid, 'students'), where('status', '==', 'ACTIVE'))),
      count(query(tcol(iid, 'faculty'), where('status', '==', 'ACTIVE'))),
      count(tcol(iid, 'departments')),
      count(tcol(iid, 'courses')),
      list(query(tcol(iid, 'classSessions'), where('date', '==', today()))),
    ]);
    const sum = (k) => sessions.reduce((n, s) => n + (s[k] ?? 0), 0);
    return { students, faculty, departments, courses, present: sum('presentCount'), absent: sum('absentCount'), leave: sum('leaveCount'), sessions: sessions.length };
  }, [iid]);
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  const pct = percent(data.present, data.absent);
  const tiles = [
    ['Active students', data.students], ['Active faculty', data.faculty],
    ['Departments', data.departments], ['Courses', data.courses],
  ];
  return (
    <>
      <div className="grid">
        {tiles.map(([label, n]) => (
          <div className="card" key={label}><div className="stat">{n}</div><div className="stat-label">{label}</div></div>
        ))}
      </div>
      <div className="card">
        <h2>Today's attendance</h2>
        {data.sessions === 0 ? <p className="muted">No registers saved yet today.</p> : (
          <p>
            {data.sessions} class sessions · <Badge kind="ok">{data.present} present</Badge>{' '}
            <Badge kind="bad">{data.absent} absent</Badge> <Badge kind="warn">{data.leave} leave</Badge>
            {pct !== null && <> · {pct}% present</>}
          </p>
        )}
      </div>
    </>
  );
}

function StudentSummary() {
  const { iid, profile } = useCtx();
  const { data, loading, error } = useAsync(async () => {
    const docs = await list(query(tcol(iid, 'studentAttendance'), where('studentId', '==', profile.studentId)));
    const t = Object.values(attendanceBySubject(docs));
    const present = t.reduce((n, x) => n + x.present, 0);
    const absent = t.reduce((n, x) => n + x.absent, 0);
    return { present, absent, overall: percent(present, absent) };
  }, [iid]);
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  return (
    <div className="card">
      <div className="stat">{data.overall === null ? '—' : `${data.overall}%`}</div>
      <div className="stat-label">Overall attendance ({data.present} present, {data.absent} absent; leave not counted)</div>
    </div>
  );
}

function FacultySummary() {
  const { iid, profile } = useCtx();
  const { data, loading } = useAsync(
    () => count(query(tcol(iid, 'teachingAssignments'), where('facultyId', '==', profile.facultyId), where('active', '==', true))),
    [iid],
  );
  if (loading) return <Loading />;
  return <div className="card"><div className="stat">{data}</div><div className="stat-label">Classes you teach now</div></div>;
}

export default function Dashboard() {
  const { role, profile } = useCtx();
  return (
    <>
      <PageHeader title={`Hello, ${profile.displayName}`} />
      {isAdminRole(role) && <AdminStats />}
      {role === ROLES.STUDENT && <StudentSummary />}
      {role === ROLES.FACULTY && <FacultySummary />}
      <div className="card">
        <h2>Announcements</h2>
        <AnnouncementList limitTo={5} />
      </div>
    </>
  );
}
