import { useState } from 'react';
import { addDoc, getDoc, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { useCtx } from '../../app/AuthProvider';
import { tcol, tdoc, isAdminRole, ROLES } from '../../lib/tenant';
import { leaveOverlaps, toCsv } from '../../lib/calc';
import { list } from '../../lib/data';
import { Alert, Badge, Button, Input, Loading, Modal, PageHeader, Table, Tabs, Textarea, downloadCsv, useAction, useAsync, useConfirm, useForm } from '../../components/ui';

const KIND = { LEAVE: 'Leave', GRIEVANCE: 'Concern' };
const TONE = { PENDING: 'warn', APPROVED: 'ok', RESOLVED: 'ok', REJECTED: 'bad', REVOKED: 'bad', CANCELLED: '' };
const when = (t) => t?.toDate?.().toLocaleDateString() ?? '';
const dates = (r) => (r.kind === 'LEAVE' ? (r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`) : '');

export default function Requests() {
  const { role } = useCtx();
  return isAdminRole(role) ? <Inbox /> : <MyRequests />;
}

/* ---------------- student or faculty ---------------- */

function MyRequests() {
  const { iid, profile, role } = useCtx();
  const [who, whoId] = role === ROLES.FACULTY ? ['facultyId', profile.facultyId] : ['studentId', profile.studentId];
  const [filing, setFiling] = useState(null); // 'LEAVE' | 'GRIEVANCE'
  const { data, loading, error, reload } = useAsync(
    () => list(query(tcol(iid, 'requests'), where(who, '==', whoId), orderBy('createdAt', 'desc'), limit(50))), [iid],
  );
  const action = useAction();
  const confirm = useConfirm();

  const cancel = (r) =>
    action.run(async () => {
      await updateDoc(tdoc(iid, 'requests', r.id), { status: 'CANCELLED', updatedAt: serverTimestamp() });
      reload();
    }, 'Request cancelled.');

  return (
    <>
      <PageHeader title="My requests">
        <Button variant="primary" onClick={() => setFiling('LEAVE')}>Ask for leave</Button>
        <Button onClick={() => setFiling('GRIEVANCE')}>Share a concern</Button>
      </PageHeader>
      <p className="muted">Ask for leave, or tell your college about a problem. An admin will answer here.</p>
      <Alert kind="error">{error?.message || action.error}</Alert>
      <Alert kind="ok">{action.done}</Alert>
      {loading ? <Loading /> : (
        <Table
          rows={data}
          empty="Nothing yet. Your requests will show up here."
          columns={[
            { key: 'kind', label: 'Type', render: (r) => KIND[r.kind] },
            { key: 'subject', label: 'About' },
            { key: 'dates', label: 'Dates', render: dates },
            { key: 'status', label: 'Status', render: (r) => <Badge kind={TONE[r.status]}>{r.status.toLowerCase()}</Badge> },
            { key: 'response', label: 'Answer', render: (r) => r.response ?? '' },
          ]}
          actions={(r) => r.status === 'PENDING' && (
            <Button small variant="danger" disabled={action.busy}
              onClick={() => confirm.ask({ title: 'Cancel this request?', body: `“${r.subject}” will no longer be looked at.`, label: 'Cancel request' }, () => cancel(r))}>Cancel</Button>
          )}
        />
      )}
      {confirm.dialog}
      {filing && <NewRequest kind={filing} existing={data ?? []} onClose={(saved) => { setFiling(null); if (saved) reload(); }} />}
    </>
  );
}

function NewRequest({ kind, existing, onClose }) {
  const { iid, profile, role, today } = useCtx();
  const faculty = role === ROLES.FACULTY;
  const leave = kind === 'LEAVE';
  const { values, bind } = useForm({ subject: '', message: '', fromDate: '', toDate: '' });
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (leave && values.fromDate > values.toDate) throw new Error('The last day cannot be before the first day.');
      if (values.message.trim().length < 10) throw new Error('Please write at least 10 characters.');
      if (leave && leaveOverlaps(existing, values.fromDate, values.toDate).length) throw new Error('You already have a waiting or approved leave on some of these days.');
      // The rules compare the name with the saved record, so use that, not a copy.
      const person = (await getDoc(tdoc(iid, faculty ? 'faculty' : 'students', faculty ? profile.facultyId : profile.studentId))).data();
      await addDoc(tcol(iid, 'requests'), {
        kind, ...(faculty ? { facultyId: profile.facultyId, facultyName: person.name } : { studentId: profile.studentId, studentName: person.name }),
        subject: values.subject.trim(), message: values.message.trim(),
        ...(leave ? { fromDate: values.fromDate, toDate: values.toDate } : {}),
        status: 'PENDING', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      onClose(true);
    });
  };
  return (
    <Modal title={leave ? 'Ask for leave' : 'Share a concern'} onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label={leave ? 'Reason in a few words' : 'What is it about?'} required maxLength={120} {...bind('subject')} />
          {leave && <Input label="First day" type="date" required {...bind('fromDate')} />}
          {leave && <Input label="Last day" type="date" required {...bind('toDate')} />}
          {leave && values.fromDate && values.fromDate < today() && <p className="muted">These days have already started or passed. Tell us why in the box below.</p>}
          <Textarea label={leave ? 'Anything else we should know?' : 'Tell us what happened'} required minLength={10} maxLength={1000} {...bind('message')} />
        </div>
        <div className="row">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- admin ---------------- */

function Inbox() {
  const { iid } = useCtx();
  const [tab, setTab] = useState('PENDING');
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = useAsync(
    () => list(query(tcol(iid, 'requests'),
      ...(tab === 'PENDING' ? [where('status', '==', 'PENDING')] : []), orderBy('createdAt', 'desc'), limit(50))),
    [iid, tab],
  );
  return (
    <>
      <PageHeader title="Requests">
        <Button disabled={!data?.length} onClick={() => downloadCsv('requests.csv', toCsv([['From', 'Type', 'About', 'Dates', 'Status', 'Answer', 'Sent'],
          ...data.map((r) => [r.studentName ?? `${r.facultyName} (faculty)`, KIND[r.kind], r.subject, dates(r), r.status, r.response ?? '', when(r.createdAt)])]))}>Export CSV</Button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'PENDING', label: 'Waiting' }, { value: 'ALL', label: 'Everything' }]} />
      <Alert kind="error">{error?.message}</Alert>
      {loading ? <Loading /> : (
        <Table
          rows={data}
          empty={tab === 'PENDING' ? 'Nothing is waiting. Nice.' : 'No requests yet.'}
          columns={[
            { key: 'studentName', label: 'From', render: (r) => r.studentName ?? `${r.facultyName} (faculty)` },
            { key: 'kind', label: 'Type', render: (r) => KIND[r.kind] },
            { key: 'subject', label: 'About' },
            { key: 'dates', label: 'Dates', render: dates },
            { key: 'status', label: 'Status', render: (r) => <Badge kind={TONE[r.status]}>{r.status.toLowerCase()}</Badge> },
            { key: 'createdAt', label: 'Sent', render: (r) => when(r.createdAt) },
          ]}
          actions={(r) => <Button small variant={r.status === 'PENDING' ? 'primary' : undefined} onClick={() => setOpen(r)}>{r.status === 'PENDING' ? 'Review' : 'View'}</Button>}
        />
      )}
      {open && <Review r={open} onClose={(saved) => { setOpen(null); if (saved) reload(); }} />}
    </>
  );
}

function Review({ r, onClose }) {
  const { iid, uid } = useCtx();
  const { values, bind } = useForm({ response: '' });
  const { busy, error, run } = useAction();
  const decide = (status) =>
    run(async () => {
      if ((status === 'REJECTED' || status === 'REVOKED') && !values.response.trim()) throw new Error('Please give a reason. The person will see it.');
      await updateDoc(tdoc(iid, 'requests', r.id), {
        status, response: values.response.trim(), decidedBy: uid, decidedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      onClose(true);
    });
  const pending = r.status === 'PENDING';
  return (
    <Modal title={`${KIND[r.kind]} from ${r.studentName ?? r.facultyName}`} onClose={() => onClose(false)}>
      <Alert kind="error">{error}</Alert>
      <p><strong>{r.subject}</strong>{dates(r) && <> · {dates(r)}</>}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{r.message}</p>
      {pending ? (
        <>
          <Textarea label="Your answer (the student sees this)" maxLength={500} {...bind('response')} />
          {r.kind === 'LEAVE' && <p className="muted">Approving does not change attendance. Mark those days as Leave in the register. A rejection needs a reason.</p>}
          <div className="modal-actions">
            <Button onClick={() => onClose(false)}>Close</Button>
            {r.kind === 'LEAVE' ? (
              <>
                <Button variant="danger" disabled={busy} onClick={() => decide('REJECTED')}>Reject</Button>
                <Button variant="primary" disabled={busy} onClick={() => decide('APPROVED')}>Approve</Button>
              </>
            ) : <Button variant="primary" disabled={busy} onClick={() => decide('RESOLVED')}>Mark as resolved</Button>}
          </div>
        </>
      ) : (
        <>
          <p><Badge kind={TONE[r.status]}>{r.status.toLowerCase()}</Badge> {r.response && <>“{r.response}”</>}</p>
          {r.status === 'APPROVED' && <Textarea label="Reason for revoking (the person sees this)" maxLength={500} {...bind('response')} />}
          <div className="modal-actions">
            <Button onClick={() => onClose(false)}>Close</Button>
            {r.status === 'APPROVED' && <Button variant="danger" disabled={busy} onClick={() => decide('REVOKED')}>Revoke leave</Button>}
          </div>
        </>
      )}
    </Modal>
  );
}
