import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDoc, deleteDoc, getCountFromServer, getDoc, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { collection } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { isAdminRole, tcol, tdoc } from '../../lib/tenant';
import { list } from '../../lib/data';
import { Alert, Badge, Button, Input, Loading, Modal, PageHeader, Select, Textarea, useAction, useAsync, useConfirm, useForm } from '../../components/ui';

const TYPES = [['HOLIDAY', 'Holiday'], ['EXAM', 'Exam'], ['EVENT', 'Event'], ['OTHER', 'Other']];
const TYPE_NAME = Object.fromEntries(TYPES);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const span = (e) => (e.startDate === e.endDate ? e.startDate : `${e.startDate} to ${e.endDate}`);
const rsvpDoc = (iid, eventId, uid) => tdoc(iid, 'calendarEvents', eventId, 'rsvps', uid);
const rsvpCol = (iid, eventId) => collection(db, 'institutions', iid, 'calendarEvents', eventId, 'rsvps');

export default function Calendar() {
  const { iid, role, today } = useCtx();
  const admin = isAdminRole(role);
  const [month, setMonth] = useState(() => { const [y, m] = today().split('-').map(Number); return new Date(y, m - 1, 1); });
  const [open, setOpen] = useState(null);   // an event
  const [day, setDay] = useState(null);     // a date whose events are listed
  const [editing, setEditing] = useState(null);
  const first = iso(month);
  const lastDate = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const last = iso(lastDate);
  const { data, loading, error, reload } = useAsync(async () => {
    // One range on endDate; the start is checked here because Firestore allows a range on one field only.
    const rows = await list(query(tcol(iid, 'calendarEvents'), where('endDate', '>=', first), orderBy('endDate'), limit(200)));
    return rows.filter((e) => e.startDate <= last).sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [iid, first]);
  const action = useAction();
  const confirm = useConfirm();

  const on = (date) => (data ?? []).filter((e) => e.startDate <= date && date <= e.endDate);
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const cells = [...Array(month.getDay()).fill(null), ...Array.from({ length: lastDate.getDate() }, (_, i) => iso(new Date(month.getFullYear(), month.getMonth(), i + 1)))];
  const title = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const remove = (e) =>
    action.run(async () => {
      // shortcut: sign-ups under the event stay behind (rules let only their owners delete them); they are unreachable and tiny.
      await deleteDoc(tdoc(iid, 'calendarEvents', e.id));
      reload();
    }, 'Event deleted.');

  return (
    <>
      <PageHeader title="Calendar">
        {admin && <Button variant="primary" onClick={() => setEditing({})}>Add event</Button>}
      </PageHeader>
      <Alert kind="error">{error?.message || action.error}</Alert>
      <Alert kind="ok">{action.done}</Alert>
      <div className="cal-head">
        <Button small onClick={() => shift(-1)} aria-label="Previous month">‹</Button>
        <h2>{title}</h2>
        <Button small onClick={() => shift(1)} aria-label="Next month">›</Button>
        <Button small onClick={() => { const [y, m] = today().split('-').map(Number); setMonth(new Date(y, m - 1, 1)); }}>Today</Button>
      </div>
      {loading ? <Loading /> : (
        <>
          <div className="cal">
            {WEEKDAYS.map((w) => <div className="cal-wd" key={w}>{w}</div>)}
            {cells.map((date, i) => {
              if (!date) return <div className="cal-day empty" key={`b${i}`} />;
              const events = on(date);
              return (
                <div className={`cal-day${date === today() ? ' today' : ''}`} key={date}>
                  <span className="cal-n">{Number(date.slice(8))}</span>
                  {events.slice(0, 2).map((e) => <button type="button" className={`chip ${e.type}`} key={e.id} onClick={() => setOpen(e)}>{e.title}</button>)}
                  {events.length > 2 && <button type="button" className="chip more" onClick={() => setDay(date)}>+{events.length - 2} more</button>}
                </div>
              );
            })}
          </div>
          <div className="card">
            <h2>This month</h2>
            {data.length === 0 ? <p className="muted">Nothing planned this month.</p> : (
              <ul className="agenda">
                {data.map((e) => (
                  <li key={e.id}>
                    <span className="agenda-date">{span(e)}</span>
                    <button type="button" className="link" onClick={() => setOpen(e)}>{e.title}</button>
                    <Badge kind={e.type === 'HOLIDAY' ? 'bad' : e.type === 'EXAM' ? 'warn' : e.type === 'EVENT' ? 'ok' : ''}>{TYPE_NAME[e.type]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {confirm.dialog}
      {day && (
        <Modal title={day} onClose={() => setDay(null)}>
          <ul className="agenda">{on(day).map((e) => <li key={e.id}><button type="button" className="link" onClick={() => { setDay(null); setOpen(e); }}>{e.title}</button> <Badge>{TYPE_NAME[e.type]}</Badge></li>)}</ul>
          <div className="modal-actions"><Button onClick={() => setDay(null)}>Close</Button></div>
        </Modal>
      )}
      {open && (
        <EventDetail e={open} admin={admin} onClose={() => setOpen(null)}
          onEdit={() => { setEditing(open); setOpen(null); }}
          onDelete={() => { const e = open; setOpen(null); confirm.ask({ title: `Delete “${e.title}”?`, body: 'It disappears from everyone\'s calendar.', label: 'Delete event' }, () => remove(e)); }} />
      )}
      {editing && <EventForm e={editing} onClose={(saved) => { setEditing(null); if (saved) reload(); }} />}
    </>
  );
}

function EventDetail({ e, admin, onClose, onEdit, onDelete }) {
  const { iid, uid, profile } = useCtx();
  const mine = useAsync(async () => (e.rsvp ? (await getDoc(rsvpDoc(iid, e.id, uid))).exists() : false), [e.id]);
  const going = useAsync(async () => (admin && e.rsvp
    ? (await list(query(rsvpCol(iid, e.id), limit(200)))).map((r) => r.name)
    : []), [e.id]);
  const action = useAction();

  const toggle = () =>
    action.run(async () => {
      if (mine.data) await deleteDoc(rsvpDoc(iid, e.id, uid));
      else await setDoc(rsvpDoc(iid, e.id, uid), { name: profile.displayName, createdAt: serverTimestamp() });
      mine.reload();
      going.reload();
    });

  return (
    <Modal title={e.title} onClose={onClose}>
      <p><Badge kind={e.type === 'HOLIDAY' ? 'bad' : e.type === 'EXAM' ? 'warn' : e.type === 'EVENT' ? 'ok' : ''}>{TYPE_NAME[e.type]}</Badge> {span(e)}</p>
      {e.description && <p style={{ whiteSpace: 'pre-wrap' }}>{e.description}</p>}
      <Alert kind="error">{action.error}</Alert>
      {e.rsvp && (
        <div className="card rsvp">
          <p>{mine.data ? 'You are going.' : 'Are you coming?'}</p>
          <Button variant={mine.data ? undefined : 'primary'} disabled={action.busy || mine.loading} onClick={toggle}>{mine.data ? 'I can’t make it' : 'I’m going'}</Button>
          {admin && going.data && <p className="muted">{going.data.length} going{going.data.length ? `: ${going.data.join(', ')}` : ''}</p>}
        </div>
      )}
      <div className="modal-actions">
        {admin && <Button variant="danger" onClick={onDelete}>Delete</Button>}
        {admin && <Button onClick={onEdit}>Edit</Button>}
        <Button variant="primary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

function EventForm({ e, onClose }) {
  const { iid, uid, today } = useCtx();
  const { values, bind, set } = useForm({
    title: e.title ?? '', type: e.type ?? 'EVENT', startDate: e.startDate ?? today(), endDate: e.endDate ?? today(),
    description: e.description ?? '', rsvp: e.rsvp ?? false,
  });
  const { busy, error, run } = useAction();
  const submit = (ev) => {
    ev.preventDefault();
    run(async () => {
      if (values.endDate < values.startDate) throw new Error('The last day cannot be before the first day.');
      const fields = {
        title: values.title.trim(), type: values.type, startDate: values.startDate, endDate: values.endDate,
        description: values.description.trim(), rsvp: values.rsvp, updatedAt: serverTimestamp(),
      };
      if (e.id) await updateDoc(tdoc(iid, 'calendarEvents', e.id), fields);
      else await addDoc(tcol(iid, 'calendarEvents'), { ...fields, createdBy: uid, createdAt: serverTimestamp() });
      onClose(true);
    });
  };
  return (
    <Modal title={e.id ? 'Edit event' : 'Add event'} onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Title" required maxLength={120} {...bind('title')} />
          <Select label="Type" required options={TYPES.map(([value, label]) => ({ value, label }))} {...bind('type')} />
          <Input label="First day" type="date" required {...bind('startDate')} />
          <Input label="Last day" type="date" required {...bind('endDate')} />
          <Textarea label="Details" maxLength={1000} {...bind('description')} />
        </div>
        <label className="check">
          <input type="checkbox" checked={values.rsvp} onChange={(x) => set((s) => ({ ...s, rsvp: x.target.checked }))} />
          Let people say they are going
        </label>
        <div className="row">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// The next few events, for the dashboards.
export function UpcomingEvents({ max = 3 }) {
  const { iid, today } = useCtx();
  const { data, loading, error } = useAsync(
    () => list(query(tcol(iid, 'calendarEvents'), where('endDate', '>=', today()), orderBy('endDate'), limit(max))), [iid],
  );
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  return (
    <>
      {data.length === 0 ? <p className="muted">Nothing coming up.</p> : (
        <ul className="agenda">
          {data.map((e) => (
            <li key={e.id}><span className="agenda-date">{span(e)}</span> {e.title} <Badge>{TYPE_NAME[e.type]}</Badge></li>
          ))}
        </ul>
      )}
      <Link to="/calendar">Open the calendar</Link>
    </>
  );
}
