import { useState } from 'react';
import { doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { ROLES, isAdminRole, tcol, tdoc } from '../../lib/tenant';
import { generateTimetable, roomKey, slotLocks } from '../../lib/calc';
import { byId, chunk, list } from '../../lib/data';
import { Alert, Button, Input, Loading, Modal, PageHeader, Select, Table, toOptions, useAction, useAsync, useForm } from '../../components/ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

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
  const [generating, setGenerating] = useState(false);
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
        {sectionId && <Button variant="primary" onClick={() => setGenerating(true)}>Generate automatically</Button>}
      </div>
      <Alert kind="error">{slots.error?.message}</Alert>
      {sectionId && !slots.loading && (
        <Grid slots={slots.data} onPick={(s) => setEditing({ ...s, sectionId })} />
      )}
      {generating && (
        <Generate sectionId={sectionId} onClose={(saved) => { setGenerating(false); if (saved) slots.reload(); }} />
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
      const oldLocks = isNew ? [] : slotLocks(slot);
      const newLocks = slotLocks(next);
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
      slotLocks(slot).forEach((id) => batch.delete(tdoc(iid, 'timetableLocks', id)));
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

// Builds a week for one section from its active teaching assignments, around everything already booked.
function Generate({ sectionId, onClose }) {
  const { iid } = useCtx();
  const assignments = useAsync(
    () => list(query(tcol(iid, 'teachingAssignments'), where('sectionId', '==', sectionId), where('active', '==', true))), [iid, sectionId],
  );
  const { values, bind, set } = useForm({ rooms: '', periods: '6', days: [1, 2, 3, 4, 5], perWeek: {}, clear: false });
  const [plan, setPlan] = useState(null);
  const [progress, setProgress] = useState('');
  const { busy, error, run } = useAction();

  const toggleDay = (d) => set((v) => ({ ...v, days: v.days.includes(d) ? v.days.filter((x) => x !== d) : [...v.days, d].sort() }));
  const sessions = (a) => values.perWeek[a.id] ?? 3;

  const generate = (e) => {
    e.preventDefault();
    run(async () => {
      const names = [...new Map(values.rooms.split(',').map((r) => r.trim()).filter(Boolean).map((r) => [roomKey(r), r]))];
      if (!names.length) throw new Error('Enter at least one room.');
      if (names.some(([key]) => key.includes('/'))) throw new Error('Room names cannot contain "/".');
      if (!values.days.length) throw new Error('Choose at least one day.');
      const requirements = assignments.data.map((a) => ({ id: a.id, facultyId: a.facultyId, perWeek: Number(sessions(a)) })).filter((r) => r.perWeek > 0);
      if (!requirements.length) throw new Error('Give at least one subject some classes per week.');
      const keys = names.map(([key]) => key);
      const facultyIds = [...new Set(assignments.data.map((a) => a.facultyId))];
      // Only what can clash: these teachers' classes, these rooms' classes, and this section's own. Not the whole college.
      const [byFaculty, byRoom, own] = await Promise.all([
        Promise.all(chunk(facultyIds, 30).map((ids) => list(query(tcol(iid, 'timetableSlots'), where('facultyId', 'in', ids))))),
        Promise.all(chunk(keys, 30).map((ks) => list(query(tcol(iid, 'timetableSlots'), where('roomKey', 'in', ks))))),
        list(query(tcol(iid, 'timetableSlots'), where('sectionId', '==', sectionId))),
      ]);
      const all = new Map([...byFaculty.flat(), ...byRoom.flat(), ...own].map((x) => [x.id, x]));
      const kept = [...all.values()].filter((x) => !(values.clear && x.sectionId === sectionId));
      const busy = new Set(kept.flatMap(slotLocks));
      const periods = Array.from({ length: Number(values.periods) }, (_, i) => i + 1);
      const result = generateTimetable({ sectionId, requirements, days: values.days, periods, rooms: keys, busy });
      setPlan({ ...result, requirements, kept: kept.filter((x) => x.sectionId === sectionId), roomName: Object.fromEntries(names), remove: values.clear ? own : [], periods });
    });
  };

  const save = () =>
    run(async () => {
      const byAssignment = byId(assignments.data);
      // The old week goes first, so its places are free for the new one.
      for (const part of chunk(plan.remove, 100)) {
        const batch = writeBatch(db);
        part.forEach((x) => { slotLocks(x).forEach((id) => batch.delete(tdoc(iid, 'timetableLocks', id))); batch.delete(tdoc(iid, 'timetableSlots', x.id)); });
        await batch.commit();
      }
      const items = plan.placements.map((pl) => {
        const a = byAssignment[pl.id];
        return {
          ref: doc(tcol(iid, 'timetableSlots')),
          slot: {
            sectionId, subjectId: a.subjectId, subjectName: a.subjectName, facultyId: a.facultyId, facultyName: a.facultyName,
            assignmentId: a.id, dayOfWeek: pl.dayOfWeek, period: pl.period, room: plan.roomName[pl.roomKey], roomKey: pl.roomKey,
          },
        };
      });
      let done = 0;
      try {
        // A slot needs three lookups in the rules and a batch allows about 20, so five at a time.
        for (const part of chunk(items, 5)) {
          const batch = writeBatch(db);
          part.forEach(({ ref, slot }) => {
            slotLocks(slot).forEach((id) => batch.set(tdoc(iid, 'timetableLocks', id), { slotId: ref.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
            batch.set(ref, { ...slot, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          });
          await batch.commit();
          done += part.length;
          setProgress(`Saved ${done} of ${items.length}`);
        }
      } catch (err) {
        if (err.code === 'permission-denied') {
          throw new Error(`Saved ${done} of ${items.length} classes, then a room or teacher was booked by someone else. Generate again to fill the rest.`);
        }
        throw err;
      }
      onClose(true);
    });

  if (assignments.loading) return <Modal wide title="Generate timetable" onClose={() => onClose(false)}><Loading /></Modal>;

  if (plan) {
    const subject = byId(assignments.data);
    const at = (d, p) => plan.placements.filter((x) => x.dayOfWeek === d && x.period === p);
    const keptAt = (d, p) => plan.kept.filter((x) => x.dayOfWeek === d && x.period === p);
    return (
      <Modal wide title="Generate timetable" onClose={busy ? () => {} : () => onClose(false)}>
        <Alert kind="error">{error}</Alert>
        <p><strong>{plan.placements.length}</strong> classes will be added{plan.remove.length > 0 && <>, after removing this section's <strong>{plan.remove.length}</strong> current classes</>}.</p>
        {plan.unplaced.length > 0 && (
          <Alert kind="error">
            Not everything fits. Free more periods, add another room, or ask for fewer classes per week:
            <ul>{plan.unplaced.map((u) => <li key={u.id}>{subject[u.id].subjectName}: {u.missing} class{u.missing === 1 ? '' : 'es'} left out</li>)}</ul>
          </Alert>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Period</th>{values.days.map((d) => <th key={d} scope="col">{DAYS[d - 1]}</th>)}</tr></thead>
            <tbody>
              {plan.periods.map((p) => (
                <tr key={p}>
                  <th scope="row">{p}</th>
                  {values.days.map((d) => (
                    <td key={d}>
                      {at(d, p).map((x) => <div key={x.id}><strong>{subject[x.id].subjectName}</strong><div className="muted">{plan.roomName[x.roomKey]}</div></div>)}
                      {!values.clear && keptAt(d, p).map((x) => <div key={x.id} className="muted">{x.subjectName} (already there)</div>)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <Button onClick={() => setPlan(null)} disabled={busy}>Back</Button>
          <Button variant="primary" onClick={save} disabled={busy || !plan.placements.length}>
            {busy ? progress || 'Saving…' : plan.remove.length ? 'Replace the timetable' : 'Save timetable'}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal wide title="Generate timetable" onClose={() => onClose(false)}>
      <form onSubmit={generate}>
        <Alert kind="error">{error}</Alert>
        {assignments.data.length === 0 ? (
          <Alert kind="info">This section has no active teaching assignments yet. Add them under Academics first.</Alert>
        ) : (
          <>
            <fieldset className="days">
              <legend>School days</legend>
              {DAYS.map((name, i) => (
                <label key={name} className="check">
                  <input type="checkbox" checked={values.days.includes(i + 1)} onChange={() => toggleDay(i + 1)} /> {name}
                </label>
              ))}
            </fieldset>
            <div className="form-grid">
              <Select label="Periods per day" required options={PERIODS.map((p) => ({ value: String(p), label: String(p) }))} {...bind('periods')} />
              <Input label="Rooms" required hint="Separate with commas. The first is this section's own; the others are used when it is taken." {...bind('rooms')} />
            </div>
            <h3>Classes per week</h3>
            <Table
              rows={assignments.data}
              columns={[
                { key: 'subjectName', label: 'Subject' },
                { key: 'facultyName', label: 'Teacher' },
                {
                  key: 'n', label: 'Per week',
                  render: (a) => (
                    <input type="number" min="0" max="12" aria-label={`Classes per week for ${a.subjectName}`} value={sessions(a)}
                      onChange={(e) => set((v) => ({ ...v, perWeek: { ...v.perWeek, [a.id]: e.target.value } }))} />
                  ),
                },
              ]}
            />
            <label className="check">
              <input type="checkbox" checked={values.clear} onChange={(e) => set((v) => ({ ...v, clear: e.target.checked }))} />
              Remove this section's current timetable first (otherwise only empty periods are filled)
            </label>
          </>
        )}
        <div className="row">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || assignments.data.length === 0}>{busy ? 'Working…' : 'Generate'}</Button>
        </div>
      </form>
    </Modal>
  );
}
