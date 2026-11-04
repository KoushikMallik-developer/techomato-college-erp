import { Link } from 'react-router-dom';
import { doc, getCountFromServer, getDoc, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol, isAdminRole, ROLES } from '../../lib/tenant';
import { attendanceBySubject, attendanceStreak, percent } from '../../lib/calc';
import { list } from '../../lib/data';
import { Alert, Badge, Loading, PageHeader, useAsync } from '../../components/ui';
import { Icon, Mascot, Ring, greeting } from '../../components/widgets';
import { AnnouncementList } from '../announcements/Announcements';
import { UpcomingEvents } from '../calendar/Calendar';

const count = async (q) => (await getCountFromServer(q)).data().count;

function AdminStats() {
  const { iid, today } = useCtx();
  const { data, loading, error } = useAsync(async () => {
    const [students, faculty, departments, courses, sessions, pending] = await Promise.all([
      count(query(tcol(iid, 'students'), where('status', '==', 'ACTIVE'))),
      count(query(tcol(iid, 'faculty'), where('status', '==', 'ACTIVE'))),
      count(tcol(iid, 'departments')),
      count(tcol(iid, 'courses')),
      list(query(tcol(iid, 'classSessions'), where('date', '==', today()))),
      count(query(tcol(iid, 'requests'), where('status', '==', 'PENDING'))),
    ]);
    const sum = (k) => sessions.reduce((n, s) => n + (s[k] ?? 0), 0);
    return { students, faculty, departments, courses, pending, present: sum('presentCount'), absent: sum('absentCount'), leave: sum('leaveCount'), sessions: sessions.length };
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
        <Link to="/requests" className="card tile-link">
          <div className="stat">{data.pending}</div><div className="stat-label">Student requests waiting</div>
        </Link>
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

const BADGES = [
  ['First step', 'Your first class is on record', (d) => d.marked > 0],
  ['Safe zone', 'Attendance of 75% or more', (d) => d.overall !== null && d.overall >= 75],
  ['Steady', 'Attendance of 90% or more', (d) => d.overall !== null && d.overall >= 90],
  ['On a roll', 'Five days present in a row', (d) => d.streak >= 5],
];
const TILES = [
  ['/attendance', 'My attendance', 'M20 6 9 17l-5-5'],
  ['/exams', 'My results', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5'],
  ['/calendar', 'Calendar', 'M3 6h18v15H3zM16 2v4M8 2v4M3 10h18'],
  ['/requests', 'Ask or tell us', 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'],
];

function StudentHome() {
  const { iid, profile } = useCtx();
  const { data, loading, error } = useAsync(async () => {
    const docs = await list(query(tcol(iid, 'studentAttendance'), where('studentId', '==', profile.studentId)));
    const t = Object.values(attendanceBySubject(docs));
    const sum = (k) => t.reduce((n, x) => n + x[k], 0);
    return { overall: percent(sum('present'), sum('absent')), marked: sum('present') + sum('absent') + sum('leave'), streak: attendanceStreak(docs) };
  }, [iid]);
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  const low = data.overall !== null && data.overall < 75;
  const message = data.overall === null ? 'Your attendance will show up here once your teachers take their first register.'
    : data.overall >= 90 ? 'Superstar! Your attendance is brilliant. Keep it going.'
    : data.overall >= 75 ? 'You are on track. Every class you attend keeps you there.'
    : 'Careful: you are under 75%. Try not to miss the next few classes.';
  return (
    <>
      <section className="card hero-card">
        <Mascot size={96} mood={low ? 'worried' : 'happy'} />
        <div className="hero-text">
          <h1>{greeting()}, {profile.displayName.split(' ')[0]}!</h1>
          <p>{message}</p>
          {data.streak > 1 && <p className="streak">{data.streak} days present in a row</p>}
        </div>
        <Ring value={data.overall} label="Overall attendance" />
      </section>
      <div className="tiles">
        {TILES.map(([to, label, d]) => (
          <Link to={to} className="card tile" key={to}><Icon d={d} size={28} /><span>{label}</span></Link>
        ))}
      </div>
      <div className="card">
        <h2>Your badges</h2>
        <ul className="badges">
          {BADGES.map(([name, how, earned]) => (
            <li key={name} className={earned(data) ? 'got' : ''}>
              <span className="badge-star" aria-hidden="true"><Icon d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" size={22} /></span>
              <strong>{name}</strong>
              <span className="muted">{earned(data) ? how : `Locked: ${how}`}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
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

const ACTIONS = {
  STUDENT_DEACTIVATED: 'deactivated a student', STUDENT_REACTIVATED: 'reactivated a student', STUDENT_RENAMED: 'renamed a student',
  FACULTY_DEACTIVATED: 'deactivated a faculty member', FACULTY_REACTIVATED: 'reactivated a faculty member', FACULTY_RENAMED: 'renamed a faculty member',
  USER_CREATED: 'added an admin', USER_DEACTIVATED: 'blocked a user', USER_REACTIVATED: 'unblocked a user',
  RESULTS_PUBLISHED: 'published results', RESULTS_UNPUBLISHED: 'unpublished results', PAPER_REMOVED: 'removed an exam paper',
  MARKS_RECORD_REMOVED: 'removed a marks record', ASSIGNMENT_DEACTIVATED: 'ended a teaching assignment',
};
const sentence = (action) => ACTIONS[action] ?? action.toLowerCase().replaceAll('_', ' ');

// The latest audit entries in plain words: 8 reads for the entries plus one per person who made them.
function ActivityFeed() {
  const { iid } = useCtx();
  const { data, loading, error } = useAsync(async () => {
    const logs = await list(query(tcol(iid, 'auditLogs'), orderBy('timestamp', 'desc'), limit(8)));
    const names = {};
    await Promise.all([...new Set(logs.map((l) => l.actorUid))].map(async (id) => {
      names[id] = (await getDoc(doc(db, 'users', id)).catch(() => null))?.data()?.displayName ?? 'Someone';
    }));
    return logs.map((l) => ({ ...l, who: names[l.actorUid] }));
  }, [iid]);
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  return data.length === 0 ? <p className="muted">Nothing has happened yet.</p> : (
    <ul className="agenda">
      {data.map((l) => (
        <li key={l.id}><span className="agenda-date">{l.timestamp?.toDate?.().toLocaleString()}</span> {l.who} {sentence(l.action)}</li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { role, profile } = useCtx();
  return (
    <>
      {role === ROLES.STUDENT ? <StudentHome /> : <PageHeader title={`Hello, ${profile.displayName}`} />}
      {isAdminRole(role) && <AdminStats />}
      {role === ROLES.FACULTY && <FacultySummary />}
      <div className="grid two">
        <div className="card">
          <h2>Announcements</h2>
          <AnnouncementList limitTo={5} />
        </div>
        <div className="card">
          <h2>Coming up</h2>
          <UpcomingEvents />
        </div>
      </div>
      {isAdminRole(role) && (
        <div className="card">
          <h2>Recent activity</h2>
          <ActivityFeed />
        </div>
      )}
    </>
  );
}
