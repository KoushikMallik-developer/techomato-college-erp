// Fills the LOCAL emulators with a small demo college, so every screen has something to show.
// Never run this against a real project: it refuses unless the emulator variables are set.
// Usage (emulators running): node scripts/seed-demo.js
// Every demo login uses the password below.
import admin from 'firebase-admin';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Set FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST first (this only seeds the emulators).');
  process.exit(1);
}
const PASSWORD = 'Passw0rd!';
const iid = 'demo';

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-erp' });
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;
const put = (path, data) => db.doc(path).set(data);
const inst = (path, data) => put(`institutions/${iid}/${path}`, data);

async function account(email, name, profile) {
  const user = await admin.auth().createUser({ email, password: PASSWORD, displayName: name });
  await put(`users/${user.uid}`, { ...profile, displayName: name, email, active: true, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return user.uid;
}

const platformUid = await account('admin@techomato.local', 'Platform Admin', { institutionId: 'platform', role: 'PLATFORM_ADMIN' });
const adminUid = await account('principal@demo.test', 'Priya Principal', { institutionId: iid, role: 'SUPER_ADMIN' });
const facultyUid = await account('teacher@demo.test', 'Meera Rao', { institutionId: iid, role: 'FACULTY', facultyId: 'f1' });
const librarianUid = await account('librarian@demo.test', 'Lata Library', { institutionId: iid, role: 'LIBRARIAN', libraryId: 'lib1' });
const studentUid = await account('student@demo.test', 'Aarav Sharma', { institutionId: iid, role: 'STUDENT', studentId: 's1' });

await put(`institutions/${iid}`, { name: 'Demo College', code: iid, status: 'ACTIVE', timezone: 'UTC', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
await inst('libraries/lib1', { name: 'Demo library', librarianEmail: 'librarian@demo.test', librarianUid, status: 'ACTIVE', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
await inst('departments/d1', { name: 'Science' });
await inst('courses/c1', { name: 'B.Sc. Mathematics', departmentId: 'd1' });
await inst('academicYears/y1', { name: '2026-27' });
await inst('semesters/sem1', { name: 'Semester 1', courseId: 'c1', academicYearId: 'y1', number: 1 });
await inst('semesters/sem2', { name: 'Semester 2', courseId: 'c1', academicYearId: 'y1', number: 2 });
await inst('sections/sec3', { name: 'Section C', courseId: 'c1', academicYearId: 'y1', semesterId: 'sem2' });
await inst('sections/sec1', { name: 'Section A', courseId: 'c1', academicYearId: 'y1', semesterId: 'sem1' });
await inst('sections/sec2', { name: 'Section B', courseId: 'c1', academicYearId: 'y1', semesterId: 'sem1' });
await inst('subjects/sub1', { name: 'Mathematics', courseId: 'c1', semesterNumber: 1, maxMarks: 100, passMarks: 40 });
await inst('faculty/f1', { name: 'Meera Rao', employeeCode: 'E01', email: 'teacher@demo.test', designation: 'Lecturer', status: 'ACTIVE', uid: facultyUid });
await inst('students/s1', { name: 'Aarav Sharma', enrollmentNumber: 'EN001', enrollmentKey: 'EN001', email: 'student@demo.test', status: 'ACTIVE', uid: studentUid });
await inst('students/s2', { name: 'Diya Patel', enrollmentNumber: 'EN002', enrollmentKey: 'EN002', email: '', status: 'ACTIVE' });
await inst('enrollmentNumberIndex/EN001', { studentId: 's1' });
await inst('enrollmentNumberIndex/EN002', { studentId: 's2' });
await inst('subjects/sub2', { name: 'Physics', courseId: 'c1', semesterNumber: 1, maxMarks: 100, passMarks: 40 });
await inst('faculty/f2', { name: 'Ravi Iyer', employeeCode: 'E02', email: '', designation: 'Lecturer', status: 'ACTIVE' });
await inst('teachingAssignments/a2', {
  facultyId: 'f2', facultyName: 'Ravi Iyer', subjectId: 'sub2', subjectName: 'Physics', sectionId: 'sec1', semesterId: 'sem1', active: true,
});
// Section B shares both teachers with Section A, so a timetable for B must work around A's.
await inst('teachingAssignments/a3', {
  facultyId: 'f2', facultyName: 'Ravi Iyer', subjectId: 'sub2', subjectName: 'Physics', sectionId: 'sec2', semesterId: 'sem1', active: true,
});
await inst('teachingAssignments/a4', {
  facultyId: 'f1', facultyName: 'Meera Rao', subjectId: 'sub1', subjectName: 'Mathematics', sectionId: 'sec2', semesterId: 'sem1', active: true,
});
await inst('teachingAssignments/a1', {
  facultyId: 'f1', facultyName: 'Meera Rao', subjectId: 'sub1', subjectName: 'Mathematics', sectionId: 'sec1', semesterId: 'sem1', active: true,
});
for (const [id, name] of [['s1', 'Aarav Sharma'], ['s2', 'Diya Patel']]) {
  await inst(`enrollments/${id}_sem1`, {
    studentId: id, studentName: name, enrollmentNumber: id === 's1' ? 'EN001' : 'EN002', courseId: 'c1', academicYearId: 'y1',
    semesterId: 'sem1', sectionId: 'sec1', status: 'ACTIVE', enrolledAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}

// Attendance: an absence long ago, then the last six days present, so the student page shows a streak.
const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10).replaceAll('-', '');
const records = { [`d${day(12)}_1`]: 'ABSENT' };
for (let back = 5; back >= 0; back--) records[`d${day(back)}_1`] = 'PRESENT';
await inst('studentAttendance/s1_a1', {
  studentId: 's1', assignmentId: 'a1', subjectId: 'sub1', semesterId: 'sem1', sectionId: 'sec1', facultyId: 'f1', records, updatedAt: Timestamp.now(),
});

await inst('announcements/n1', { title: 'Welcome to the new term', body: 'Classes begin on Monday.', status: 'PUBLISHED', audienceRoles: [], publishedAt: Timestamp.now(), createdBy: adminUid, createdAt: Timestamp.now() });
await inst('auditLogs/l1', { actorUid: adminUid, action: 'RESULTS_PUBLISHED', entityType: 'exams', entityId: 'x', metadata: {}, timestamp: Timestamp.now(), updatedAt: Timestamp.now() });

console.log(JSON.stringify({ password: PASSWORD, platformUid, logins: ['admin@techomato.local (platform)', 'principal@demo.test', 'teacher@demo.test', 'student@demo.test', 'librarian@demo.test'] }, null, 2));
