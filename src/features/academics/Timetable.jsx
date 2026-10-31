import { useState } from 'react';
import { doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { ROLES, isAdminRole, tcol, tdoc } from '../../lib/tenant';
import { roomKey } from '../../lib/calc';
import { byId, list } from '../../lib/data';
import { Alert, Button, Input, Loading, Modal, PageHeader, Select, toOptions, useAction, useAsync, useForm } from '../../components/ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

// The three places a slot occupies. A lock is create-only, so a second slot at the same place fails.
const lockIds = (s) => [
  `room_${s.roomKey}_${s.dayOfWeek}_${s.period}`,
  `faculty_${s.facultyId}_${s.dayOfWeek}_${s.period}`,
  `section_${s.sectionId}_${s.dayOfWeek}_${s.period}`,
];

export default function Timetable() {
  const { role } = useCtx();
  return (
    <>
      <PageHeader title="Timetable" />
      {isAdminRole(role) ? <AdminTimetable /> : role === ROLES.FACULTY ? <MyTimetable by="faculty" /> : <MyTimetable by="student" />}
    </>
  );
}

function Grid({ slots, sections, onPick }) {
  const at = (d, p) => slots.filter((s) => s.dayOfWeek === d && s.period === p);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th scope="col">Period</th>{DAYS.map((d) => <th key={d} scope="col">{d}</th>)}</tr>
        </thead>
        <tbody>
          {PERIODS.map((p) => (
            <tr key={p}>
              <th scope="row">{p}</th>
              {DAYS.map((_, i) => (
                <td key={i}>
                  {at(i + 1, p).map((s) => (
                    <div key={s.id}>
                      {onPick ? (
                        <Button small onClick={() => onPick(s)}>{s.subjectName}</Button>
                      ) : <strong>{s.subjectName}</strong>}
                      <div className="muted">{s.facultyName} · {s.room}{sections ? ` · ${sections[s.sectionId]?.name ?? ''}` : ''}</div>
                    </div>
                  ))}
                  {onPick && !at(i + 1, p).length && (
                    <Button small onClick={() => onPick({ dayOfWeek: i + 1, period: p })} aria-label={`Add slot ${DAYS[i]} period ${p}`}>+</Button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MyTimetable({ by }) {
  const { iid, profile } = useCtx();
  const { data, loading, error } = useAsync(async () => {
    if (by === 'faculty') {
      return { slots: await list(query(tcol(iid, 'timetableSlots'), where('facultyId', '==', profile.facultyId))) };
    }
    const enrollments = await list(query(tcol(iid, 'enrollments'), where('studentId', '==', profile.studentId), where('status', '==', 'ACTIVE')));
    const sectionId = enrollments[0]?.sectionId;
    return { slots: sectionId ? await list(query(tcol(iid, 'timetableSlots'), where('sectionId', '==', sectionId))) : [], noClass: !sectionId };
  }, [iid]);
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  if (data.noClass) return <Alert kind="info">You are not enrolled in a class yet.</Alert>;
  return <Grid slots={data.slots} />;
}

function AdminTimetable() {
  const { iid } = useCtx();
  const [sectionId, setSectionId] = useState('');
  const [editing, setEditing] = useState(null);
  const sections = useAsync(() => list(tcol(iid, 'sections')), [iid]);
  const slots = useAsync(
    () => (sectionId ? list(query(tcol(iid, 'timetableSlots'), where('sectionId', '==', sectionId))) : Promise.resolve([])),
    [iid, sectionId],
  );
  if (sections.loading) return <Loading />;
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Select label="Section" value={sectionId} onChange={setSectionId} options={toOptions(sections.data)} />
      </div>
      <Alert kind="error">{slots.error?.message}</Alert>
      {sectionId && !slots.loading && (
        <Grid slots={slots.data} onPick={(s) => setEditing({ ...s, sectionId })} />
      )}
      {editing && (
        <SlotForm
          slot={editing}
          onClose={(saved) => { setEditing(null); if (saved) slots.reload(); }}
        />
      )}
    </>
  );
}

function SlotForm({ slot, onClose }) {
  const { iid } = useCtx();
  const isNew = !slot.id;
  const assignments = useAsync(
    () => list(query(tcol(iid, 'teachingAssignments'), where('sectionId', '==', slot.sectionId), where('active', '==', true))),
    [iid, slot.sectionId],
  );
  const { values, bind } = useForm({
    assignmentId: '', room: slot.room ?? '', dayOfWeek: String(slot.dayOfWeek), period: String(slot.period),
  });
  const { busy, error, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (values.room.includes('/')) throw new Error('Room names cannot contain "/".');
      const a = byId(assignments.data)[values.assignmentId] ?? (!isNew && { ...slot, id: slot.assignmentId });
      if (!a) throw new Error('Choose a subject and teacher.');
      const next = {
        sectionId: slot.sectionId, subjectId: a.subjectId, subjectName: a.subjectName, facultyId: a.facultyId,
        facultyName: a.facultyName, assignmentId: a.id, dayOfWeek: Number(values.dayOfWeek), period: Number(values.period),
        room: values.room.trim(), roomKey: roomKey(values.room),
      };
      const slotRef = isNew ? doc(tcol(iid, 'timetableSlots')) : tdoc(iid, 'timetableSlots', slot.id);
      const oldLocks = isNew ? [] : lockIds(slot);
      const newLocks = lockIds(next);
      const batch = writeBatch(db);
      oldLocks.filter((id) => !newLocks.includes(id)).forEach((id) => batch.delete(tdoc(iid, 'timetableLocks', id)));
      newLocks.filter((id) => !oldLocks.includes(id)).forEach((id) =>
        batch.set(tdoc(iid, 'timetableLocks', id), { slotId: slotRef.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
      batch.set(slotRef, { ...next, updatedAt: serverTimestamp(), ...(isNew && { createdAt: serverTimestamp() }) });
      try {
        await batch.commit();
      } catch (err) {
        if (err.code === 'permission-denied') throw new Error('That room, teacher or section is already booked in this period.');
        throw err;
      }
      onClose(true);
    });
  };

  const remove = () =>
    run(async () => {
      const batch = writeBatch(db);
      lockIds(slot).forEach((id) => batch.delete(tdoc(iid, 'timetableLocks', id)));
      batch.delete(tdoc(iid, 'timetableSlots', slot.id));
      await batch.commit();
      onClose(true);
    });

  if (confirming) {
    return (
      <Modal title="Delete this slot?" onClose={() => setConfirming(false)}>
        <Alert kind="error">{error}</Alert>
        <p className="muted">{slot.subjectName}, {slot.facultyName}, room {slot.room}. The room, teacher and section are free in that period again.</p>
        <div className="modal-actions">
          <Button onClick={() => setConfirming(false)} disabled={busy}>Keep it</Button>
          <Button variant="danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete slot'}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={isNew ? 'Add slot' : 'Edit slot'} onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          {isNew || assignments.data ? (
            <Select
              label={isNew ? 'Subject and teacher' : `Subject and teacher (now: ${slot.subjectName}, ${slot.facultyName})`}
              required={isNew}
              value={values.assignmentId}
              onChange={bind('assignmentId').onChange}
              options={(assignments.data ?? []).map((a) => ({ value: a.id, label: `${a.subjectName} — ${a.facultyName}` }))}
              placeholder={isNew ? 'Select…' : 'Keep current'}
            />
          ) : null}
          <Input label="Room" required {...bind('room')} />
          <Select label="Day" required options={DAYS.map((d, i) => ({ value: String(i + 1), label: d }))} {...bind('dayOfWeek')} />
          <Select label="Period" required options={PERIODS.map((p) => ({ value: String(p), label: String(p) }))} {...bind('period')} />
        </div>
        {assignments.data?.length === 0 && <Alert kind="info">No active teaching assignments for this section yet. Add one under Academics.</Alert>}
        <div className="row" style={{ marginTop: 12 }}>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          {!isNew && <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>Delete slot</Button>}
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
