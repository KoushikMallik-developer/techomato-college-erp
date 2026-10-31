// Needs the Firestore emulator: npm run test:rules
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';

let env;
const P = (iid, ...rest) => ['institutions', iid, ...rest];
const as = (uid) => env.authenticatedContext(uid).firestore();
const now = () => serverTimestamp();

const users = {
  plat: { role: 'PLATFORM_ADMIN', institutionId: 'platform' },
  sa1: { role: 'SUPER_ADMIN', institutionId: 'c1' },
  ca1: { role: 'COLLEGE_ADMIN', institutionId: 'c1' },
  fac1: { role: 'FACULTY', institutionId: 'c1', facultyId: 'f1' },
  fac2: { role: 'FACULTY', institutionId: 'c1', facultyId: 'f2' },
  stu1: { role: 'STUDENT', institutionId: 'c1', studentId: 's1' },
  stu2: { role: 'STUDENT', institutionId: 'c1', studentId: 's2' },
  ca2: { role: 'COLLEGE_ADMIN', institutionId: 'c2' },
};

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (path, data) => setDoc(doc(db, ...path), data);
    for (const [uid, u] of Object.entries(users)) await put(['users', uid], { ...u, active: true, displayName: uid });
    await put(P('c1'), { name: 'One', status: 'ACTIVE', timezone: 'UTC' });
    await put(P('c2'), { name: 'Two', status: 'ACTIVE', timezone: 'UTC' });
    await put(P('c1', 'students', 's1'), { name: 'S1', enrollmentNumber: 'A1', enrollmentKey: 'A1', status: 'ACTIVE' });
    await put(P('c1', 'students', 's2'), { name: 'S2', enrollmentNumber: 'A2', enrollmentKey: 'A2', status: 'ACTIVE' });
    await put(P('c1', 'enrollmentNumberIndex', 'A1'), { studentId: 's1' });
    await put(P('c1', 'enrollmentNumberIndex', 'A2'), { studentId: 's2' });
    await put(P('c2', 'students', 'x1'), { name: 'X1', enrollmentNumber: 'B1', enrollmentKey: 'B1', status: 'ACTIVE' });
    await put(P('c1', 'teachingAssignments', 'a1'), { facultyId: 'f1', active: true, sectionId: 'sec1', subjectId: 'sub1', semesterId: 'sem1', subjectName: 'Maths' });
    await put(P('c1', 'teachingAssignments', 'a2'), { facultyId: 'f2', active: true, sectionId: 'sec2', subjectId: 'sub1', semesterId: 'sem1', subjectName: 'Maths' });
    await put(P('c1', 'enrollments', 's1_sem1'), { studentId: 's1', sectionId: 'sec1', semesterId: 'sem1', status: 'ACTIVE' });
    await put(P('c1', 'enrollments', 's2_sem1'), { studentId: 's2', sectionId: 'sec2', semesterId: 'sem1', status: 'WITHDRAWN' });
    await put(P('c1', 'exams', 'e1'), { status: 'DRAFT', semesterId: 'sem1' });
    await put(P('c1', 'exams', 'e2'), { status: 'PUBLISHED', semesterId: 'sem1' });
    await put(P('c1', 'exams', 'e3'), { status: 'PUBLISHED', semesterId: 'sem1' });
    await put(P('c1', 'examSubjects', 'es1'), { examId: 'e1', subjectId: 'sub1', maxMarks: 100 });
    await put(P('c1', 'examSubjects', 'es2'), { examId: 'e2', subjectId: 'sub1', maxMarks: 100 });
    await put(P('c1', 'results', 'e2_s1'), { examId: 'e2', studentId: 's1', total: 50 });
    await put(P('c1', 'results', 'e1_s1'), { examId: 'e1', studentId: 's1', total: 50 });
    await put(P('c1', 'auditLogs', 'old'), { actorUid: 'ca1' });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'rules-test', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(() => env.cleanup());
beforeEach(seed);

const audit = (db, iid, uid, id) => setDoc(doc(db, ...P(iid, 'auditLogs', id)), { actorUid: uid, timestamp: now() });
const mark = (key, status) => ({
  studentId: 's1', subjectId: 'sub1', semesterId: 'sem1', sectionId: 'sec1', assignmentId: 'a1', facultyId: 'f1',
  records: { [key]: status },
});

describe('tenant isolation', () => {
  it('a college admin reads their own college but not another', async () => {
    const db = as('ca1');
    await assertSucceeds(getDoc(doc(db, ...P('c1', 'students', 's1'))));
    await assertFails(getDoc(doc(db, ...P('c2', 'students', 'x1'))));
    await assertFails(setDoc(doc(db, ...P('c2', 'departments', 'd')), { name: 'x' }));
  });

  it("another college's admin cannot write here either", async () => {
    await assertFails(setDoc(doc(as('ca2'), ...P('c1', 'departments', 'd')), { name: 'x' }));
  });

  it('a student reads only their own record', async () => {
    const db = as('stu1');
    await assertSucceeds(getDoc(doc(db, ...P('c1', 'students', 's1'))));
    await assertFails(getDoc(doc(db, ...P('c1', 'students', 's2'))));
  });

  it('a suspended college is locked out', async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), ...P('c1')), { status: 'SUSPENDED' }));
    await assertFails(getDoc(doc(as('ca1'), ...P('c1', 'students', 's1'))));
  });

  it('a deactivated user is denied even with a valid session', async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'users', 'ca1'), { active: false }));
    await assertFails(getDoc(doc(as('ca1'), ...P('c1', 'students', 's1'))));
  });
});

describe('platform admin', () => {
  it('cannot read college data', async () => {
    await assertFails(getDoc(doc(as('plat'), ...P('c1', 'students', 's1'))));
    await assertFails(getDocs(collection(as('plat'), ...P('c1', 'studentMarks'))));
  });

  it('creates a college with its first super admin in one batch', async () => {
    const db = as('plat');
    const b = writeBatch(db);
    b.set(doc(db, 'platformAuditLogs', 'p1'), { actorUid: 'plat', timestamp: now() });
    b.set(doc(db, 'institutions', 'c9'), { name: 'Nine', status: 'ACTIVE', auditId: 'p1' });
    b.set(doc(db, 'users', 'newsa'), { institutionId: 'c9', role: 'SUPER_ADMIN', active: true, auditId: 'p1' });
    await assertSucceeds(b.commit());
  });

  it('cannot create a super admin for an existing college', async () => {
    const db = as('plat');
    const b = writeBatch(db);
    b.set(doc(db, 'platformAuditLogs', 'p2'), { actorUid: 'plat', timestamp: now() });
    b.set(doc(db, 'users', 'sneaky'), { institutionId: 'c1', role: 'SUPER_ADMIN', active: true, auditId: 'p2' });
    await assertFails(b.commit());
  });
});

describe('user management', () => {
  it('a college admin cannot touch a super admin, nor create admins', async () => {
    const db = as('ca1');
    const b = writeBatch(db);
    b.set(doc(db, ...P('c1', 'auditLogs', 'n1')), { actorUid: 'ca1', timestamp: now() });
    b.update(doc(db, 'users', 'sa1'), { active: false, auditId: 'n1' });
    await assertFails(b.commit());

    const b2 = writeBatch(db);
    b2.set(doc(db, ...P('c1', 'auditLogs', 'n2')), { actorUid: 'ca1', timestamp: now() });
    b2.set(doc(db, 'users', 'evil'), { institutionId: 'c1', role: 'COLLEGE_ADMIN', active: true, auditId: 'n2' });
    await assertFails(b2.commit());
  });

  it('nobody can create a platform admin or a super admin from a college', async () => {
    const db = as('sa1');
    for (const role of ['PLATFORM_ADMIN', 'SUPER_ADMIN']) {
      const b = writeBatch(db);
      b.set(doc(db, ...P('c1', 'auditLogs', `a-${role}`)), { actorUid: 'sa1', timestamp: now() });
      b.set(doc(db, 'users', `u-${role}`), { institutionId: 'c1', role, active: true, auditId: `a-${role}` });
      await assertFails(b.commit());
    }
  });

  it('a super admin can create a college admin; the audit entry must be new', async () => {
    const db = as('sa1');
    const ok = writeBatch(db);
    ok.set(doc(db, ...P('c1', 'auditLogs', 'new1')), { actorUid: 'sa1', timestamp: now() });
    ok.set(doc(db, 'users', 'ca9'), { institutionId: 'c1', role: 'COLLEGE_ADMIN', active: true, auditId: 'new1' });
    await assertSucceeds(ok.commit());

    const reuse = writeBatch(db);
    reuse.set(doc(db, 'users', 'ca10'), { institutionId: 'c1', role: 'COLLEGE_ADMIN', active: true, auditId: 'old' });
    await assertFails(reuse.commit());
  });

  it('a college admin can deactivate a faculty login but not move it to another college', async () => {
    const db = as('ca1');
    const b = writeBatch(db);
    b.set(doc(db, ...P('c1', 'auditLogs', 'd1')), { actorUid: 'ca1', timestamp: now() });
    b.update(doc(db, 'users', 'fac1'), { active: false, auditId: 'd1' });
    await assertSucceeds(b.commit());

    const mv = writeBatch(db);
    mv.set(doc(db, ...P('c1', 'auditLogs', 'd2')), { actorUid: 'ca1', timestamp: now() });
    mv.update(doc(db, 'users', 'fac2'), { institutionId: 'c2', auditId: 'd2' });
    await assertFails(mv.commit());
  });
});

describe('attendance', () => {
  const ref = (db, id = 's1_a1') => doc(db, ...P('c1', 'studentAttendance', id));

  it('the assigned teacher can mark; another teacher or a wrong label cannot', async () => {
    await assertSucceeds(setDoc(ref(as('fac1')), mark('d20261031_1', 'PRESENT')));
    await assertFails(setDoc(ref(as('fac2')), mark('d20261031_1', 'PRESENT')));
    await assertFails(setDoc(ref(as('fac1')), { ...mark('d20261031_1', 'PRESENT'), sectionId: 'sec2' }));
    await assertFails(setDoc(ref(as('fac1')), { ...mark('d20261031_1', 'MAYBE') }));
  });

  it('adding a new entry is free; changing an existing one needs a new audit entry used once', async () => {
    const db = as('fac1');
    await assertSucceeds(setDoc(ref(db), mark('d20261031_1', 'PRESENT')));
    await assertSucceeds(updateDoc(ref(db), { 'records.d20261031_2': 'ABSENT', updatedBy: 'fac1' }));

    const noAudit = updateDoc(ref(db), { 'records.d20261031_1': 'ABSENT', updatedBy: 'fac1' });
    await assertFails(noAudit);

    const old = writeBatch(db);
    old.update(ref(db), { 'records.d20261031_1': 'ABSENT', auditId: 'old' });
    await assertFails(old.commit());

    const good = writeBatch(db);
    good.set(doc(db, ...P('c1', 'auditLogs', 'edit1')), { actorUid: 'fac1', timestamp: now() });
    good.update(ref(db), { 'records.d20261031_1': 'ABSENT', auditId: 'edit1' });
    await assertSucceeds(good.commit());
  });

  it('two entries in one write are refused', async () => {
    const db = as('fac1');
    await assertSucceeds(setDoc(ref(db), mark('d20261031_1', 'PRESENT')));
    await assertFails(updateDoc(ref(db), { 'records.d20261031_2': 'ABSENT', 'records.d20261031_3': 'ABSENT' }));
  });

  it('a replaced teacher loses write access immediately', async () => {
    await assertSucceeds(setDoc(ref(as('fac1')), mark('d20261031_1', 'PRESENT')));
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), ...P('c1', 'teachingAssignments', 'a1')), { active: false }));
    await assertFails(updateDoc(ref(as('fac1')), { 'records.d20261031_2': 'ABSENT' }));
  });

  it('a student reads only their own attendance', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(ref(ctx.firestore()), mark('d20261031_1', 'PRESENT')));
    await assertSucceeds(getDocs(query(collection(as('stu1'), ...P('c1', 'studentAttendance')), where('studentId', '==', 's1'))));
    await assertFails(getDocs(query(collection(as('stu2'), ...P('c1', 'studentAttendance')), where('studentId', '==', 's1'))));
  });

  it('a 60-student register fits the rule lookup limits', async () => {
    const db = as('fac1');
    const b = writeBatch(db);
    for (let i = 0; i < 60; i++) {
      b.set(doc(db, ...P('c1', 'studentAttendance', `s${i}_a1`)), { ...mark('d20261031_1', 'PRESENT'), studentId: `s${i}` });
    }
    await assertSucceeds(b.commit());
  });
});

describe('marks and results', () => {
  const markRef = (db, id = 'es1_s1') => doc(db, ...P('c1', 'studentMarks', id));
  const marks = (over = {}) => ({
    examId: 'e1', examSubjectId: 'es1', assignmentId: 'a1', sectionId: 'sec1', studentId: 's1', marks: 70, absent: false,
    enteredBy: 'fac1', ...over,
  });

  it('the assigned teacher enters marks within range', async () => {
    await assertSucceeds(setDoc(markRef(as('fac1')), marks()));
    await assertFails(setDoc(markRef(as('fac1'), 'es1_s2'), marks({ studentId: 's2', marks: 101 })));
  });

  it('another section\'s teacher cannot write or overwrite marks', async () => {
    await assertFails(setDoc(markRef(as('fac2')), marks({ enteredBy: 'fac2' })));
    await env.withSecurityRulesDisabled((ctx) => setDoc(markRef(ctx.firestore()), marks()));
    await assertFails(updateDoc(markRef(as('fac2')), { marks: 10 }));
  });

  it('cannot use a draft exam id to write into a published exam', async () => {
    await assertFails(setDoc(markRef(as('fac1'), 'es2_s1'), marks({ examId: 'e1', examSubjectId: 'es2' })));
    await assertFails(setDoc(markRef(as('fac1'), 'es2_s1'), marks({ examId: 'e2', examSubjectId: 'es2' })));
  });

  it('marks are locked once the exam is published', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(markRef(ctx.firestore()), marks()));
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), ...P('c1', 'exams', 'e1')), { status: 'PUBLISHED' }));
    await assertFails(updateDoc(markRef(as('fac1')), { marks: 99 }));
  });

  it('students see only published results of their own, fetched by id', async () => {
    const db = as('stu1');
    await assertSucceeds(getDoc(doc(db, ...P('c1', 'results', 'e2_s1'))));
    await assertSucceeds(getDoc(doc(db, ...P('c1', 'results', 'e3_s1')))); // published exam, no result yet
    await assertFails(getDoc(doc(db, ...P('c1', 'results', 'e1_s1')))); // draft exam
    await assertFails(getDoc(doc(db, ...P('c1', 'results', 'e2_s2')))); // someone else's
    await assertFails(getDoc(doc(as('stu2'), ...P('c1', 'results', 'e2_s1'))));
  });

  it('results can be written only while the exam is a draft', async () => {
    const draft = setDoc(doc(as('ca1'), ...P('c1', 'results', 'e1_s2')), { examId: 'e1', studentId: 's2' });
    await assertSucceeds(draft);
    await assertFails(updateDoc(doc(as('ca1'), ...P('c1', 'results', 'e2_s1')), { total: 99 }));
  });
});

describe('timetable locks and enrollment numbers', () => {
  const lockSet = (b, db, ids, slotId) => ids.forEach((id) => b.set(doc(db, ...P('c1', 'timetableLocks', id)), { slotId }));
  const slot = (over = {}) => ({
    sectionId: 'sec1', facultyId: 'f1', dayOfWeek: 1, period: 1, room: 'Room 1', roomKey: 'room 1', ...over,
  });
  const locks = (s) => [`room_${s.roomKey}_1_1`, `faculty_${s.facultyId}_1_1`, `section_${s.sectionId}_1_1`];

  it('saves a slot with its locks, and refuses a clash', async () => {
    const db = as('ca1');
    const a = writeBatch(db);
    lockSet(a, db, locks(slot()), 'slotA');
    a.set(doc(db, ...P('c1', 'timetableSlots', 'slotA')), slot());
    await assertSucceeds(a.commit());

    const b = writeBatch(db);
    const clash = slot({ sectionId: 'sec2', facultyId: 'f2' }); // same room, same period
    lockSet(b, db, locks(clash), 'slotB');
    b.set(doc(db, ...P('c1', 'timetableSlots', 'slotB')), clash);
    await assertFails(b.commit());
  });

  it('a slot cannot be moved onto a place another slot holds', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const b = writeBatch(db);
      lockSet(b, db, locks(slot()), 'slotA');
      b.set(doc(db, ...P('c1', 'timetableSlots', 'slotA')), slot());
      const other = slot({ sectionId: 'sec2', facultyId: 'f2', room: 'Room 2', roomKey: 'room 2', period: 2 });
      b.set(doc(db, ...P('c1', 'timetableLocks', 'room_room 2_1_2')), { slotId: 'slotB' });
      b.set(doc(db, ...P('c1', 'timetableLocks', 'faculty_f2_1_2')), { slotId: 'slotB' });
      b.set(doc(db, ...P('c1', 'timetableLocks', 'section_sec2_1_2')), { slotId: 'slotB' });
      b.set(doc(db, ...P('c1', 'timetableSlots', 'slotB')), other);
      await b.commit();
    });
    // Edit slot B to period 1 and room 1 without creating locks: the locks name slot A, so it fails.
    await assertFails(updateDoc(doc(as('ca1'), ...P('c1', 'timetableSlots', 'slotB')), { period: 1, room: 'Room 1', roomKey: 'room 1' }));
  });

  it('rejects an enrollment number that collides after normalising', async () => {
    const db = as('ca1');
    const dupe = writeBatch(db);
    dupe.set(doc(db, ...P('c1', 'enrollmentNumberIndex', 'A1')), { studentId: 'new' }); // existing key: an update, refused
    dupe.set(doc(db, ...P('c1', 'students', 'new')), { enrollmentNumber: 'a1', enrollmentKey: 'A1', status: 'ACTIVE' });
    await assertFails(dupe.commit());

    const wrongKey = writeBatch(db);
    wrongKey.set(doc(db, ...P('c1', 'enrollmentNumberIndex', 'zz9')), { studentId: 'n2' });
    wrongKey.set(doc(db, ...P('c1', 'students', 'n2')), { enrollmentNumber: 'ZZ9', enrollmentKey: 'zz9', status: 'ACTIVE' });
    await assertFails(wrongKey.commit());
  });

  it('the enrollment number cannot be changed', async () => {
    await assertFails(updateDoc(doc(as('ca1'), ...P('c1', 'students', 's1')), { enrollmentNumber: 'A2', enrollmentKey: 'A2' }));
    await assertSucceeds(updateDoc(doc(as('ca1'), ...P('c1', 'students', 's1')), { status: 'INACTIVE' }));
  });
});

describe('files and audit', () => {
  const fileDoc = (owner, slotId) => doc(as('ca1'), ...P('c1', 'students', owner, 'documents', slotId));
  const meta = (slotId, over = {}) => ({
    objectKey: `c1/students/s1/${slotId}`, uploadedBy: 'ca1', status: 'PENDING', size: 1000, contentType: 'application/pdf', ...over,
  });

  it('only fixed slot ids are accepted, which caps the files per folder', async () => {
    await assertSucceeds(setDoc(fileDoc('s1', 'f01'), meta('f01')));
    await assertFails(setDoc(fileDoc('s1', 'f21'), meta('f21')));
    await assertFails(setDoc(fileDoc('s1', 'abc'), meta('abc')));
    await assertFails(setDoc(fileDoc('s1', 'f02'), meta('f02', { size: 2000000 })));
    await assertFails(setDoc(fileDoc('s1', 'f03'), meta('f03', { contentType: 'text/html' })));
  });

  it('status only moves forward and a record is deleted only after DELETED', async () => {
    const ref = fileDoc('s1', 'f01');
    await assertSucceeds(setDoc(ref, meta('f01')));
    await assertSucceeds(updateDoc(ref, { status: 'READY' }));
    await assertFails(deleteDoc(ref));
    await assertSucceeds(updateDoc(ref, { status: 'DELETED' }));
    await assertFails(updateDoc(ref, { status: 'READY' }));
    await assertSucceeds(deleteDoc(ref));
  });

  it('a student can read their files but not upload or mark them deleted', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), ...P('c1', 'students', 's1', 'documents', 'f01')), meta('f01', { status: 'READY' })));
    const mine = doc(as('stu1'), ...P('c1', 'students', 's1', 'documents', 'f01'));
    await assertSucceeds(getDoc(mine));
    await assertFails(updateDoc(mine, { status: 'DELETED' }));
    await assertFails(getDoc(doc(as('stu2'), ...P('c1', 'students', 's1', 'documents', 'f01'))));
    await assertFails(setDoc(doc(as('stu1'), ...P('c1', 'students', 's1', 'documents', 'f02')), meta('f02', { uploadedBy: 'stu1' })));
  });

  it('class materials: enrolled students read, withdrawn ones do not, a replaced teacher cannot upload', async () => {
    const m = (db) => doc(db, ...P('c1', 'teachingAssignments', 'a1', 'documents', 'm001'));
    const mmeta = { objectKey: 'c1/teachingAssignments/a1/m001', uploadedBy: 'fac1', status: 'PENDING', size: 1000, contentType: 'application/pdf' };
    await assertSucceeds(setDoc(m(as('fac1')), mmeta));
    await assertFails(setDoc(doc(as('fac2'), ...P('c1', 'teachingAssignments', 'a1', 'documents', 'm002')), { ...mmeta, objectKey: 'c1/teachingAssignments/a1/m002', uploadedBy: 'fac2' }));
    await assertSucceeds(getDoc(m(as('stu1'))));
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), ...P('c1', 'enrollments', 's1_sem1')), { status: 'WITHDRAWN' }));
    await assertFails(getDoc(m(as('stu1'))));
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), ...P('c1', 'teachingAssignments', 'a1')), { active: false }));
    await assertFails(setDoc(doc(as('fac1'), ...P('c1', 'teachingAssignments', 'a1', 'documents', 'm003')), { ...mmeta, objectKey: 'c1/teachingAssignments/a1/m003' }));
  });

  it('faculty documents are private to the owner and admins', async () => {
    const own = doc(as('fac1'), ...P('c1', 'faculty', 'f1', 'documents', 'f01'));
    await assertSucceeds(setDoc(own, { objectKey: 'c1/faculty/f1/f01', uploadedBy: 'fac1', status: 'PENDING', size: 10, contentType: 'image/png' }));
    await assertFails(getDoc(doc(as('fac2'), ...P('c1', 'faculty', 'f1', 'documents', 'f01'))));
    await assertSucceeds(getDoc(doc(as('ca1'), ...P('c1', 'faculty', 'f1', 'documents', 'f01'))));
  });

  it('students cannot write audit logs; staff can, but only as themselves', async () => {
    await assertFails(setDoc(doc(as('stu1'), ...P('c1', 'auditLogs', 'x')), { actorUid: 'stu1', timestamp: now() }));
    await assertSucceeds(setDoc(doc(as('fac1'), ...P('c1', 'auditLogs', 'y')), { actorUid: 'fac1', timestamp: now() }));
    await assertFails(setDoc(doc(as('fac1'), ...P('c1', 'auditLogs', 'z')), { actorUid: 'ca1', timestamp: now() }));
    await assertFails(updateDoc(doc(as('ca1'), ...P('c1', 'auditLogs', 'old')), { actorUid: 'x' }));
  });
});

describe('admin clean-up, locks after publish, and the rest of the rules', () => {
  const marksDoc = { examId: 'e1', examSubjectId: 'es1', assignmentId: 'a1', sectionId: 'sec2', studentId: 's1', marks: 5, absent: false, enteredBy: 'fac1' };

  it('an admin can remove a stray marks record while the exam is a draft, not after, and a teacher cannot', async () => {
    const ref = (db) => doc(db, ...P('c1', 'studentMarks', 'es1_s1'));
    await env.withSecurityRulesDisabled((ctx) => setDoc(ref(ctx.firestore()), marksDoc));
    await assertFails(deleteDoc(ref(as('fac1'))));
    await assertSucceeds(deleteDoc(ref(as('ca1'))));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(ref(ctx.firestore()), marksDoc);
      await updateDoc(doc(ctx.firestore(), ...P('c1', 'exams', 'e1')), { status: 'PUBLISHED' });
    });
    await assertFails(deleteDoc(ref(as('ca1'))));
  });

  it('papers can change only while the exam is a draft', async () => {
    await assertSucceeds(setDoc(doc(as('ca1'), ...P('c1', 'examSubjects', 'es9')), { examId: 'e1', subjectId: 'sub9', maxMarks: 50 }));
    await assertFails(setDoc(doc(as('ca1'), ...P('c1', 'examSubjects', 'es8')), { examId: 'e2', subjectId: 'sub9', maxMarks: 50 }));
    await assertFails(updateDoc(doc(as('ca1'), ...P('c1', 'examSubjects', 'es2')), { maxMarks: 10 }));
  });

  it('class sessions: only the assigned teacher, with the right id', async () => {
    const session = { assignmentId: 'a1', sectionId: 'sec1', subjectId: 'sub1', facultyId: 'f1', date: '2026-10-31', period: 1, presentCount: 1 };
    await assertSucceeds(setDoc(doc(as('fac1'), ...P('c1', 'classSessions', 'a1_2026-10-31_1')), session));
    await assertFails(setDoc(doc(as('fac1'), ...P('c1', 'classSessions', 'wrong-id')), session));
    await assertFails(setDoc(doc(as('fac2'), ...P('c1', 'classSessions', 'a1_2026-10-31_1')), { ...session, facultyId: 'f2' }));
  });

  it('faculty attendance: admins write with the right id and status; faculty cannot', async () => {
    const rec = { facultyId: 'f1', date: '2026-10-31', status: 'PRESENT' };
    await assertSucceeds(setDoc(doc(as('ca1'), ...P('c1', 'facultyAttendance', 'f1_2026-10-31')), rec));
    await assertFails(setDoc(doc(as('ca1'), ...P('c1', 'facultyAttendance', 'oops')), rec));
    await assertFails(setDoc(doc(as('ca1'), ...P('c1', 'facultyAttendance', 'f1_2026-10-30')), { ...rec, date: '2026-10-30', status: 'LATE' }));
    await assertFails(setDoc(doc(as('fac1'), ...P('c1', 'facultyAttendance', 'f1_2026-10-31')), rec));
  });

  it('college settings: only the super admin, only the allowed fields', async () => {
    await assertSucceeds(updateDoc(doc(as('sa1'), ...P('c1')), { name: 'Renamed', timezone: 'Asia/Kolkata', updatedAt: now() }));
    await assertFails(updateDoc(doc(as('sa1'), ...P('c1')), { status: 'SUSPENDED' }));
    await assertFails(updateDoc(doc(as('ca1'), ...P('c1')), { name: 'Nope' }));
  });

  it('a 60-student marks batch and a 450-result publish chunk fit the lookup limits', async () => {
    const f = as('fac1');
    const b = writeBatch(f);
    for (let i = 0; i < 60; i++) {
      b.set(doc(f, ...P('c1', 'studentMarks', `es1_t${i}`)), { ...marksDoc, sectionId: 'sec1', studentId: `t${i}` });
    }
    await assertSucceeds(b.commit());

    const a = as('ca1');
    const r = writeBatch(a);
    for (let i = 0; i < 450; i++) r.set(doc(a, ...P('c1', 'results', `e1_t${i}`)), { examId: 'e1', studentId: `t${i}`, total: 1 });
    await assertSucceeds(r.commit());
  });

  it('replacing a teacher moves the timetable slots, and fails if the new teacher is already booked', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const i of [1, 2]) {
        await setDoc(doc(db, ...P('c1', 'timetableSlots', `s${i}`)), { sectionId: 'sec1', facultyId: 'f1', dayOfWeek: i, period: 1, room: 'R', roomKey: 'r', assignmentId: 'a1' });
        for (const k of [`room_r_${i}_1`, `faculty_f1_${i}_1`, `section_sec1_${i}_1`]) await setDoc(doc(db, ...P('c1', 'timetableLocks', k)), { slotId: `s${i}` });
      }
      await setDoc(doc(db, ...P('c1', 'timetableLocks', 'faculty_f2_2_1')), { slotId: 'other' }); // f2 is busy on day 2
    });
    const db = as('ca1');
    const move = (days) => {
      const b = writeBatch(db);
      for (const i of days) {
        b.delete(doc(db, ...P('c1', 'timetableLocks', `faculty_f1_${i}_1`)));
        b.set(doc(db, ...P('c1', 'timetableLocks', `faculty_f2_${i}_1`)), { slotId: `s${i}` });
        b.update(doc(db, ...P('c1', 'timetableSlots', `s${i}`)), { facultyId: 'f2', assignmentId: 'a3', updatedAt: now() });
      }
      return b.commit();
    };
    await assertFails(move([1, 2]));
    await assertSucceeds(move([1]));
  });
});
