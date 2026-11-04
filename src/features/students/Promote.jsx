import { useRef, useState } from 'react';
import { query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol, tdoc } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { splitPromotion } from '../../lib/calc';
import { chunk, list } from '../../lib/data';
import { Alert, Button, Loading, Modal, Select, useAction, useAsync } from '../../components/ui';

// Year-end move: every active student of one section finishes their semester and is enrolled in another section.
export default function Promote({ onClose }) {
  const { iid, uid } = useCtx();
  const refs = useAsync(async () => {
    const [sections, semesters] = await Promise.all([list(tcol(iid, 'sections')), list(tcol(iid, 'semesters'))]);
    const sem = Object.fromEntries(semesters.map((s) => [s.id, s]));
    return { sections: sections.map((s) => ({ ...s, label: `${sem[s.semesterId]?.name ?? '?'} · ${s.name}` })) };
  }, [iid]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [students, setStudents] = useState(null);
  const { busy, error, done, run } = useAction();
  const latest = useRef('');
  const [note, setNote] = useState('');

  const sections = refs.data?.sections ?? [];
  const source = sections.find((s) => s.id === from);
  const target = sections.find((s) => s.id === to);

  const pick = (id) => {
    setFrom(id);
    latest.current = id;
    setStudents(null);
    const s = sections.find((x) => x.id === id);
    if (!s) return;
    list(query(tcol(iid, 'enrollments'), where('semesterId', '==', s.semesterId), where('sectionId', '==', s.id)))
      .then((rows) => { if (latest.current === id) setStudents(rows.filter((e) => e.status === 'ACTIVE')); }); // a slower earlier pick must not win
  };

  const promote = () => run(async () => {
    if (!source || !target) throw new Error('Pick both sections.');
    if (source.semesterId === target.semesterId) throw new Error('Pick a section of a different semester. A student has one enrollment per semester.');
    if (!students?.length) throw new Error('There are no active students in that section.');
    // A student already enrolled in the target semester (placed by hand) is left as is, never overwritten.
    const { move, skipped } = splitPromotion(students, await list(query(tcol(iid, 'enrollments'), where('semesterId', '==', target.semesterId))));
    if (!move.length) throw new Error('Every student in that section already has an enrollment in the target semester.');
    // Two writes per student; 100 students per batch keeps each batch small.
    const groups = chunk(move, 100);
    for (const [i, group] of groups.entries()) {
      const batch = writeBatch(db);
      if (i === 0) audit(batch, { iid, uid }, 'CLASS_PROMOTED', 'sections', source.id, { to: target.id, students: move.length, skipped: skipped.length });
      for (const e of group) {
        batch.update(tdoc(iid, 'enrollments', e.id), { status: 'COMPLETED', updatedAt: serverTimestamp() });
        batch.set(tdoc(iid, 'enrollments', `${e.studentId}_${target.semesterId}`), {
          studentId: e.studentId, studentName: e.studentName, enrollmentNumber: e.enrollmentNumber, courseId: target.courseId,
          academicYearId: target.academicYearId, semesterId: target.semesterId, sectionId: target.id,
          status: 'ACTIVE', enrolledAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      }
      await batch.commit(); // a stop part-way leaves earlier groups moved; run it again to move the rest
    }
    setStudents([]);
    setNote(skipped.length ? `${skipped.length} already had an enrollment in the target semester and were left as they are.` : '');
  }, 'The class has been promoted.');

  return (
    <Modal title="Promote a class" onClose={() => onClose(false)}>
      {refs.loading ? <Loading /> : (
        <>
          <Alert kind="error">{error || refs.error?.message}</Alert>
          <Alert kind="ok">{done}</Alert>
          {done && note && <p className="muted">{note}</p>}
          <p className="muted">Moves every active student of one section into a section of the next semester. Their finished semester is marked completed and keeps its attendance and results.</p>
          <div className="form-grid">
            <Select label="From" options={sections.map((s) => ({ value: s.id, label: s.label }))} value={from} onChange={pick} />
            <Select label="To" options={sections.filter((s) => s.id !== from).map((s) => ({ value: s.id, label: s.label }))} value={to} onChange={setTo} />
          </div>
          {from && students && <p>{students.length} active {students.length === 1 ? 'student' : 'students'} will move.</p>}
          <div className="modal-actions">
            <Button onClick={() => onClose(Boolean(done))}>Close</Button>
            <Button variant="primary" disabled={busy || !students?.length || !to} onClick={promote}>{busy ? 'Moving…' : 'Promote'}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
