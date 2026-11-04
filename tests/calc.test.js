import { describe, expect, it } from 'vitest';
import { splitPromotion, addDays, overdueDays, toCsv, csvEscape, leaveOverlaps, parseCsv, generateTimetable, slotLocks, attendanceBySubject, attendanceStreak, checkExam, groupByCost, computeResult, enrollmentKey, percent, planAttendanceWrites, loginEmail, recordKey, roomKey, todayIn, validTimeZone } from '../src/lib/calc';

describe('attendance', () => {
  it('excludes leave from the percentage', () => {
    expect(percent(3, 1)).toBe(75);
    expect(percent(0, 0)).toBeNull();
  });

  it('totals records per subject across assignments', () => {
    const t = attendanceBySubject([
      { subjectId: 'm', records: { d20261001_1: 'PRESENT', d20261002_1: 'ABSENT', d20261003_1: 'LEAVE' } },
      { subjectId: 'm', records: { d20261004_1: 'PRESENT' } },
      { subjectId: 'p', records: { d20261001_2: 'ABSENT' } },
    ]);
    expect(t.m).toMatchObject({ present: 2, absent: 1, leave: 1, percent: 66.7 });
    expect(t.p.percent).toBe(0);
  });

  it('builds a valid field-path key', () => {
    expect(recordKey('2026-10-31', 2)).toBe('d20261031_2');
  });
});

describe('results', () => {
  const paper = (marks, extra = {}) => ({ marks, absent: false, maxMarks: 100, passMarks: 40, ...extra });

  it('passes only when every paper reaches its pass mark', () => {
    expect(computeResult([paper(60), paper(40)])).toMatchObject({ total: 100, maxTotal: 200, percentage: 50, passed: true });
    expect(computeResult([paper(90), paper(39)]).passed).toBe(false);
  });

  it('counts an absent paper as zero and fails it', () => {
    const r = computeResult([paper(80), paper(70, { absent: true })]);
    expect(r.total).toBe(80);
    expect(r.passed).toBe(false);
  });

  it('does not pass with no papers', () => {
    expect(computeResult([]).passed).toBe(false);
  });
});

describe('keys', () => {
  it('normalises enrollment numbers and rooms so case differences collide', () => {
    expect(enrollmentKey(' cs-001 ')).toBe(enrollmentKey('CS-001'));
    expect(roomKey(' Room 101 ')).toBe(roomKey('room 101'));
  });

  it('uses the college time zone for the calendar date', () => {
    const lateUtc = new Date('2026-10-30T20:00:00Z'); // 01:30 on the 31st in India
    expect(todayIn('Asia/Kolkata', lateUtc)).toBe('2026-10-31');
    expect(todayIn('UTC', lateUtc)).toBe('2026-10-30');
  });

  it('rejects a time zone typo before it is saved', () => {
    expect(validTimeZone('Asia/Kolkata')).toBe(true);
    expect(validTimeZone('Asia/Calcutta1')).toBe(false);
  });
});

describe('attendance write plan', () => {
  it('creates, adds, edits, and skips unchanged marks', () => {
    const roster = [1, 2, 3, 4].map((n) => ({ studentId: `s${n}` }));
    const saved = {
      s2: { records: { d1_1: 'PRESENT' } },
      s3: { records: { d2_1: 'PRESENT' } },
      s4: { records: { d2_1: 'ABSENT' } },
    };
    const plan = planAttendanceWrites(roster, saved, 'd2_1', () => 'ABSENT');
    expect(plan.map((p) => [p.student.studentId, p.kind])).toEqual([['s1', 'create'], ['s2', 'add'], ['s3', 'edit']]);
    expect(plan[2].old).toBe('PRESENT');
  });
});

describe('publish gate', () => {
  it('finds missing marks and marks under the wrong section, and passes a complete exam', () => {
    const enrollments = [
      { studentId: 's1', sectionId: 'A', enrollmentNumber: '1', studentName: 'One' },
      { studentId: 's2', sectionId: 'A', enrollmentNumber: '2', studentName: 'Two' },
      { studentId: 's3', sectionId: 'A', enrollmentNumber: '3', studentName: 'Three' },
    ];
    const examSubjects = [{ id: 'p1', subjectName: 'Maths' }];
    const marks = [
      { id: 'p1_s1', sectionId: 'A' }, // fine
      { id: 'p1_s2', sectionId: 'B' }, // entered under another section
      // s3 has none
    ];
    const r = checkExam({ enrollments, examSubjects, marks });
    expect(r.gaps.map((g) => g.student)).toEqual(['3 Three']);
    expect(r.wrongSection.map((w) => w.id)).toEqual(['p1_s2']);
    const ok = checkExam({ enrollments: enrollments.slice(0, 1), examSubjects, marks });
    expect([ok.gaps.length, ok.wrongSection.length]).toEqual([0, 0]);
  });
});

describe('batch grouping', () => {
  it('keeps each batch under the lookup cost limit and loses nothing', () => {
    const items = [1, 1, 2, 2, 0, 1, 2, 1].map((cost, id) => ({ cost, id }));
    const groups = groupByCost(items, 4);
    expect(groups.map((g) => g.reduce((n, i) => n + i.cost, 0)).every((n) => n <= 4)).toBe(true);
    expect(groups.flat().map((i) => i.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(groupByCost([], 4)).toEqual([]);
    expect(groupByCost([{ cost: 9 }], 4)).toHaveLength(1); // one oversized item still gets its own batch
  });
});

describe('login name', () => {
  it('maps a bare username to a fixed address and leaves emails alone', () => {
    expect(loginEmail(' Admin ')).toBe('admin@techomato.local');
    expect(loginEmail('A@B.com')).toBe('a@b.com');
  });
});

describe('attendance streak', () => {
  const doc = (records) => ({ records });
  it('counts the latest days present and stops at an absent day', () => {
    const docs = [doc({ d20261101_1: 'PRESENT', d20261102_1: 'PRESENT' }), doc({ d20261102_2: 'PRESENT', d20261103_1: 'PRESENT', d20261030_1: 'ABSENT' })];
    expect(attendanceStreak(docs)).toBe(3);
    expect(attendanceStreak([...docs, doc({ d20261102_3: 'ABSENT' })])).toBe(1);
  });
  it('skips leave-only days and is 0 with no records', () => {
    expect(attendanceStreak([doc({ d20261101_1: 'PRESENT', d20261102_1: 'LEAVE', d20261103_1: 'PRESENT' })])).toBe(2);
    expect(attendanceStreak([])).toBe(0);
  });
});

describe('automatic timetable', () => {
  const base = { sectionId: 'sec1', days: [1, 2, 3, 4, 5], periods: [1, 2, 3, 4, 5, 6], rooms: ['r1'], busy: new Set() };
  const reqs = [
    { id: 'math', facultyId: 'f1', perWeek: 5 },
    { id: 'phys', facultyId: 'f2', perWeek: 4 },
    { id: 'chem', facultyId: 'f1', perWeek: 3 }, // same teacher as maths: they can never overlap
  ];
  const clashes = (placements, key) => {
    const seen = new Set();
    for (const p of placements) {
      const k = key(p);
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  };

  it('places every session with no teacher, room or section clash', () => {
    const { placements, unplaced } = generateTimetable({ ...base, requirements: reqs });
    expect(unplaced).toEqual([]);
    expect(placements).toHaveLength(12);
    const f = Object.fromEntries(reqs.map((r) => [r.id, r.facultyId]));
    expect(clashes(placements, (p) => `${f[p.id]}_${p.dayOfWeek}_${p.period}`)).toBe(false);
    expect(clashes(placements, (p) => `${p.dayOfWeek}_${p.period}`)).toBe(false); // one section, one class at a time
  });

  it('spreads a subject over different days when it can', () => {
    const { placements } = generateTimetable({ ...base, requirements: [{ id: 'math', facultyId: 'f1', perWeek: 5 }] });
    expect(new Set(placements.map((p) => p.dayOfWeek)).size).toBe(5);
  });

  it('keeps away from places that are already taken', () => {
    const busy = new Set(['faculty_f1_1_1', 'faculty_f1_1_2', 'room_r1_2_1', 'section_sec1_3_1']);
    const { placements } = generateTimetable({ ...base, busy, requirements: reqs });
    const at = (d, p) => placements.filter((x) => x.dayOfWeek === d && x.period === p);
    expect(at(1, 1).filter((x) => x.id === 'math' || x.id === 'chem')).toEqual([]);
    expect(at(2, 1)).toEqual([]);
    expect(at(3, 1)).toEqual([]);
  });

  it('uses the next room when the first is taken, and reports what cannot fit', () => {
    const busy = new Set(['room_r1_1_1']);
    const two = generateTimetable({ ...base, rooms: ['r1', 'r2'], busy, requirements: [{ id: 'math', facultyId: 'f1', perWeek: 30 }] });
    expect(two.placements.find((p) => p.dayOfWeek === 1 && p.period === 1)?.roomKey).toBe('r2');
    const full = generateTimetable({ ...base, requirements: [{ id: 'math', facultyId: 'f1', perWeek: 31 }] });
    expect(full.unplaced).toEqual([{ id: 'math', missing: 1 }]);
    expect(full.placements).toHaveLength(30);
  });

  it('gives the same answer for the same input, and slotLocks names three places', () => {
    const a = generateTimetable({ ...base, requirements: reqs });
    expect(generateTimetable({ ...base, requirements: reqs })).toEqual(a);
    expect(slotLocks({ roomKey: 'r1', facultyId: 'f1', sectionId: 'sec1', dayOfWeek: 2, period: 3 }))
      .toEqual(['room_r1_2_3', 'faculty_f1_2_3', 'section_sec1_2_3']);
  });
});

describe('csvEscape', () => {
  it('quotes cells and neutralises spreadsheet formulas', () => {
    expect(csvEscape('Asha "A"')).toBe('"Asha ""A"""');
    expect(csvEscape('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvEscape('-5')).toBe('"-5"'); // a plain negative number is not a formula
    expect(csvEscape('+91 98765 43210')).toBe(`"'+91 98765 43210"`); // Excel would read this as a formula and show #NULL!
    expect(csvEscape(null)).toBe('""');
  });
});

describe('leaveOverlaps', () => {
  const L = (fromDate, toDate, status = 'APPROVED') => ({ kind: 'LEAVE', fromDate, toDate, status });
  it('finds waiting or approved leave that shares a day, and ignores the rest', () => {
    const all = [L('2026-11-02', '2026-11-04'), L('2026-11-10', '2026-11-10', 'REJECTED'), { kind: 'GRIEVANCE', status: 'PENDING' }];
    expect(leaveOverlaps(all, '2026-11-04', '2026-11-06')).toHaveLength(1); // touching on one day
    expect(leaveOverlaps(all, '2026-11-05', '2026-11-06')).toHaveLength(0);
    expect(leaveOverlaps(all, '2026-11-10', '2026-11-10')).toHaveLength(0); // rejected does not block
  });
});

describe('parseCsv', () => {
  it('reads quotes, commas and line breaks inside cells, CRLF, a BOM and blank lines', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\n\n"two\nlines",z')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', 'z']]);
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('round-trips what toCsv wrote', () => {
    const rows = [['n', 'v'], ['A "q"', '1,5']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('library dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-07-02', 14)).toBe('2026-07-16');
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
  });
  it('counts overdue days: due 15 July, back 17 July is 2; on time or early is 0', () => {
    expect(overdueDays('2026-07-15', '2026-07-17')).toBe(2);
    expect(overdueDays('2026-07-15', '2026-07-15')).toBe(0);
    expect(overdueDays('2026-07-15', '2026-07-10')).toBe(0);
  });
});

describe('promotion', () => {
  it('leaves students who already have a target enrollment', () => {
    const r = splitPromotion([{ studentId: 'a' }, { studentId: 'b' }], [{ studentId: 'b' }, { studentId: 'z' }]);
    expect(r.move).toEqual([{ studentId: 'a' }]);
    expect(r.skipped).toEqual([{ studentId: 'b' }]);
  });
});
