// Pure business rules. Kept free of Firebase so they can be unit tested.

export const STATUSES = ['PRESENT', 'ABSENT', 'LEAVE'];

// Attendance map key: d{YYYYMMDD}_{period}. Valid as a Firestore field path.
export const recordKey = (date, period) => `d${date.replaceAll('-', '')}_${period}`;

// Per student, how today's mark is written: create the document, add an entry, or edit an existing
// entry (an edit needs its own audit entry). Unchanged marks are skipped.
export function planAttendanceWrites(roster, saved, key, statusOf) {
  const plan = [];
  for (const student of roster) {
    const next = statusOf(student);
    const doc = saved[student.studentId];
    if (!doc) plan.push({ student, next, kind: 'create' });
    else if (doc.records[key] === undefined) plan.push({ student, next, kind: 'add' });
    else if (doc.records[key] !== next) plan.push({ student, next, kind: 'edit', old: doc.records[key] });
  }
  return plan;
}

// One batch may trigger about 20 document lookups in the rules (measured: 17 distinct lookups plus the user, college
// and assignment lookups pass, 18 fail). Items carry a `cost`; groups stay under `limit`.
export function groupByCost(items, limit) {
  const groups = [];
  let cur = [];
  let cost = 0;
  for (const item of items) {
    if (cur.length && cost + item.cost > limit) {
      groups.push(cur);
      cur = [];
      cost = 0;
    }
    cur.push(item);
    cost += item.cost;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export const enrollmentKey = (number) => number.trim().toUpperCase();
export const roomKey = (room) => room.trim().toLowerCase();

// present / (present + absent) x 100, LEAVE excluded. null when nothing counts yet.
export function percent(present, absent) {
  const total = present + absent;
  return total === 0 ? null : Math.round((present / total) * 1000) / 10;
}

// docs: studentAttendance documents of one student. Returns totals per subjectId.
export function attendanceBySubject(docs) {
  const out = {};
  for (const d of docs) {
    const t = (out[d.subjectId] ??= { present: 0, absent: 0, leave: 0 });
    for (const status of Object.values(d.records ?? {})) {
      if (status === 'PRESENT') t.present++;
      else if (status === 'ABSENT') t.absent++;
      else if (status === 'LEAVE') t.leave++;
    }
  }
  for (const t of Object.values(out)) t.percent = percent(t.present, t.absent);
  return out;
}

// papers: [{ marks, absent, maxMarks, passMarks }]. An absent paper counts as 0 and fails.
export function computeResult(papers) {
  let total = 0;
  let maxTotal = 0;
  let passed = papers.length > 0;
  for (const p of papers) {
    const got = p.absent ? 0 : Number(p.marks);
    total += got;
    maxTotal += Number(p.maxMarks);
    if (p.absent || got < Number(p.passMarks)) passed = false;
  }
  const percentage = maxTotal === 0 ? 0 : Math.round((total / maxTotal) * 10000) / 100;
  return { total, maxTotal, percentage, passed };
}

export function validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Every enrolled student needs a marks record (or an absent mark) for every paper before results publish.
// Marks ids are {paperId}_{studentId}; a record under another section than the student's enrollment is flagged.
export function checkExam({ enrollments, examSubjects, marks }) {
  const marksById = Object.fromEntries(marks.map((m) => [m.id, m]));
  const gaps = [];
  const wrongSection = [];
  for (const en of enrollments) {
    for (const es of examSubjects) {
      const m = marksById[`${es.id}_${en.studentId}`];
      const who = `${en.enrollmentNumber} ${en.studentName}`;
      if (!m) gaps.push({ id: `${en.studentId}${es.id}`, student: who, paper: es.subjectName });
      else if (m.sectionId !== en.sectionId) wrongSection.push({ id: m.id, student: who, paper: es.subjectName });
    }
  }
  return { marksById, gaps, wrongSection };
}

// Calendar date (YYYY-MM-DD) in the college's time zone.
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export const csvEscape = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
export const toCsv = (rows) => rows.map((r) => r.map(csvEscape).join(',')).join('\n');
