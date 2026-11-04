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

// Firebase Auth signs in by email. A bare username such as "admin" maps to a fixed fake address.
export const loginEmail = (s) => {
  const v = s.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@techomato.local`;
};

// docs: studentAttendance documents of one student. Consecutive most-recent days present. A day counts when it has a
// PRESENT mark and no ABSENT mark; a day with only LEAVE is skipped; the first absent day ends the run.
export function attendanceStreak(docs) {
  const days = {};
  for (const d of docs) {
    for (const [key, status] of Object.entries(d.records ?? {})) {
      const day = (days[key.slice(1, 9)] ??= { present: false, absent: false });
      if (status === 'PRESENT') day.present = true;
      else if (status === 'ABSENT') day.absent = true;
    }
  }
  let streak = 0;
  for (const date of Object.keys(days).sort().reverse()) {
    if (days[date].absent) break;
    if (days[date].present) streak++;
  }
  return streak;
}

// ---- automatic timetable ----

// The three places a slot occupies. A lock is create-only, so a second slot at the same place fails.
export const slotLocks = (s) => [
  `room_${s.roomKey}_${s.dayOfWeek}_${s.period}`,
  `faculty_${s.facultyId}_${s.dayOfWeek}_${s.period}`,
  `section_${s.sectionId}_${s.dayOfWeek}_${s.period}`,
];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Greedy placement, repeated with different shuffles; the attempt with the fewest unplaced sessions wins.
//   requirements: [{ id, facultyId, perWeek }]   rooms: room keys, the first is the section's own room
//   busy: Set of lock ids already taken (see slotLocks), including this section's own when it is kept
// Returns { placements: [{ id, dayOfWeek, period, roomKey }], unplaced: [{ id, missing }] }.
export function generateTimetable({ sectionId, requirements, days, periods, rooms, busy, attempts = 60 }) {
  const cells = days.flatMap((d) => periods.map((p) => [d, p]));
  let best = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rand = attempt === 0 ? () => 0 : mulberry32(attempt);
    const taken = new Set(busy);
    const dayLoad = Object.fromEntries(days.map((d) => [d, 0]));
    const onDay = {}; // `${id}_${day}` -> periods of that subject that day
    const placements = [];
    const unplaced = [];
    const order = [...requirements].sort((x, y) => y.perWeek - x.perWeek || (attempt ? rand() - 0.5 : 0));
    for (const req of order) {
      let missing = 0;
      for (let k = 0; k < req.perWeek; k++) {
        let pick = null;
        for (const [d, p] of cells) {
          if (taken.has(`section_${sectionId}_${d}_${p}`) || taken.has(`faculty_${req.facultyId}_${d}_${p}`)) continue;
          const room = rooms.find((r) => !taken.has(`room_${r}_${d}_${p}`));
          if (room === undefined) continue;
          const same = onDay[`${req.id}_${d}`] ?? [];
          // Lower is better: spread a subject over the days, keep each day evenly loaded, avoid back-to-back
          // repeats, lean to earlier periods, and a little noise so retries explore other layouts.
          const score = same.length * 4 + dayLoad[d] + (same.some((q) => Math.abs(q - p) === 1) ? 3 : 0) + p * 0.1 + rand() * 0.8;
          if (!pick || score < pick.score) pick = { d, p, room, score };
        }
        if (!pick) { missing++; continue; }
        taken.add(`section_${sectionId}_${pick.d}_${pick.p}`);
        taken.add(`faculty_${req.facultyId}_${pick.d}_${pick.p}`);
        taken.add(`room_${pick.room}_${pick.d}_${pick.p}`);
        dayLoad[pick.d]++;
        (onDay[`${req.id}_${pick.d}`] ??= []).push(pick.p);
        placements.push({ id: req.id, dayOfWeek: pick.d, period: pick.p, roomKey: pick.room });
      }
      if (missing) unplaced.push({ id: req.id, missing });
    }
    const lost = unplaced.reduce((n, u) => n + u.missing, 0);
    if (!best || lost < best.lost) best = { placements, unplaced, lost };
    if (lost === 0) break;
  }
  return { placements: best.placements, unplaced: best.unplaced };
}

// A cell starting with = + - @ (or tab/CR) would run as a formula in Excel, so it gets a leading apostrophe.
export const csvEscape = (v) => {
  const t = String(v ?? '');
  const risky = /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t);
  return `"${(risky ? `'${t}` : t).replaceAll('"', '""')}"`;
};
export const toCsv = (rows) => rows.map((r) => r.map(csvEscape).join(',')).join('\n');

// Waiting or approved leave that shares a day with the new range (ISO dates compare as text).
export const leaveOverlaps = (requests, from, to) =>
  requests.filter((r) => r.kind === 'LEAVE' && ['PENDING', 'APPROVED'].includes(r.status) && r.fromDate <= to && from <= r.toDate);

// Reads CSV text into rows of cells. Handles quotes, doubled quotes, commas and line breaks inside quotes, CRLF and a BOM.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// Dates are plain YYYY-MM-DD text in the college's time zone; adding days works in UTC so daylight saving cannot shift them.
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// Whole days past the due date; 0 on or before it. `until` is the return date, or today for a loan still out.
export const overdueDays = (dueDate, until) => Math.max(0, Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000));

// Enrollments to move in a promotion: the student has no enrollment in the target semester yet. The rest are left alone.
export const splitPromotion = (active, targetRows) => {
  const taken = new Set(targetRows.map((e) => e.studentId));
  return { move: active.filter((e) => !taken.has(e.studentId)), skipped: active.filter((e) => taken.has(e.studentId)) };
};
