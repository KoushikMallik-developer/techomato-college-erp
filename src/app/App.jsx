import { Suspense, lazy, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useCtx } from './AuthProvider';
import { Button, Loading } from '../components/ui';
import ErrorBoundary from '../components/ErrorBoundary';
import { ROLES, isAdminRole } from '../lib/tenant';
import Login from '../features/auth/Login';
const Dashboard = lazy(() => import('../features/dashboard/Dashboard'));
const Colleges = lazy(() => import('../features/platform/Colleges'));
const Students = lazy(() => import('../features/students/Students'));
const StudentDetail = lazy(() => import('../features/students/StudentDetail'));
const Faculty = lazy(() => import('../features/faculty/Faculty'));
const FacultyDetail = lazy(() => import('../features/faculty/FacultyDetail'));
const Academics = lazy(() => import('../features/academics/Academics'));
const Timetable = lazy(() => import('../features/academics/Timetable'));
const Attendance = lazy(() => import('../features/attendance/Attendance'));
const Exams = lazy(() => import('../features/exams/Exams'));
const Materials = lazy(() => import('../features/materials/Materials'));
const Announcements = lazy(() => import('../features/announcements/Announcements'));
const Users = lazy(() => import('../features/users/Users'));
const Settings = lazy(() => import('../features/users/Settings'));
const Profile = lazy(() => import('../features/users/Profile'));

function navFor(role) {
  if (role === ROLES.PLATFORM_ADMIN) return [['/', 'Colleges']];
  const common = [['/', 'Dashboard']];
  if (isAdminRole(role)) {
    return [
      ...common,
      ['/students', 'Students'], ['/faculty', 'Faculty'], ['/academics', 'Academics'],
      ['/timetable', 'Timetable'], ['/attendance', 'Attendance'], ['/exams', 'Exams'],
      ['/materials', 'Class materials'], ['/announcements', 'Announcements'], ['/users', 'Users & audit'],
      ...(role === ROLES.SUPER_ADMIN ? [['/settings', 'College settings']] : []),
    ];
  }
  if (role === ROLES.FACULTY) {
    return [
      ...common, ['/attendance', 'Attendance'], ['/exams', 'Marks entry'], ['/materials', 'Class materials'],
      ['/timetable', 'My timetable'], ['/announcements', 'Announcements'], ['/profile', 'My profile'],
    ];
  }
  return [
    ...common, ['/attendance', 'My attendance'], ['/exams', 'My results'], ['/materials', 'Class materials'],
    ['/timetable', 'Timetable'], ['/announcements', 'Announcements'], ['/profile', 'My profile'],
  ];
}

function Shell() {
  const { role, profile, institution, logout } = useCtx();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const admin = isAdminRole(role);
  return (
    <div className="shell">
      <Button className="menu-btn" onClick={() => setOpen(!open)} aria-expanded={open}>Menu</Button>
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand">{institution?.name ?? 'Techomato ERP'}</div>
        <nav aria-label="Main">
          {navFor(role).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>{label}</NavLink>
          ))}
        </nav>
        <div className="who">
          <div>{profile.displayName}</div>
          <div>{role.replace('_', ' ').toLowerCase()}</div>
          <Button small onClick={logout} style={{ marginTop: 8 }}>Sign out</Button>
        </div>
      </aside>
      <main className="main">
        <ErrorBoundary key={pathname} onSignOut={logout}>
        <Suspense fallback={<Loading />}>
        <Routes>
          {role === ROLES.PLATFORM_ADMIN ? (
            <Route path="/" element={<Colleges />} />
          ) : (
            <>
              <Route path="/" element={<Dashboard />} />
              <Route path="/timetable" element={<Timetable />} />
              <Route path="/attendance" element={<Attendance />} />
              <Route path="/exams" element={<Exams />} />
              <Route path="/materials" element={<Materials />} />
              <Route path="/announcements" element={<Announcements />} />
              {admin && <Route path="/students" element={<Students />} />}
              {admin && <Route path="/students/:id" element={<StudentDetail />} />}
              {admin && <Route path="/faculty" element={<Faculty />} />}
              {admin && <Route path="/faculty/:id" element={<FacultyDetail />} />}
              {admin && <Route path="/academics" element={<Academics />} />}
              {admin && <Route path="/users" element={<Users />} />}
              {role === ROLES.SUPER_ADMIN && <Route path="/settings" element={<Settings />} />}
              {!admin && <Route path="/profile" element={<Profile />} />}
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  const { loading, user, profile } = useCtx();
  if (loading) return <Loading />;
  if (!user || !profile) return <Login />;
  return <Shell />;
}
