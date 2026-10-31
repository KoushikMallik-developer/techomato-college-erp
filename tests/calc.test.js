import { describe, expect, it } from 'vitest';
import { attendanceBySubject, computeResult, enrollmentKey, percent, recordKey, roomKey, todayIn, validTimeZone } from '../src/lib/calc';

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
