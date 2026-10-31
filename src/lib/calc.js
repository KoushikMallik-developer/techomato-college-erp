// Pure business rules. Kept free of Firebase so they can be unit tested.

export const STATUSES = ['PRESENT', 'ABSENT', 'LEAVE'];

// Attendance map key: d{YYYYMMDD}_{period}. Valid as a Firestore field path.
export const recordKey = (date, period) => `d${date.replaceAll('-', '')}_${period}`;

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

// Calendar date (YYYY-MM-DD) in the college's time zone.
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export const csvEscape = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
export const toCsv = (rows) => rows.map((r) => r.map(csvEscape).join(',')).join('\n');
