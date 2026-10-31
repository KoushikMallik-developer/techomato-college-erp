import { useState } from 'react';
import { addDoc, doc, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { useCtx } from '../../app/AuthProvider';
import { ROLES, isAdminRole, tcol, tdoc } from '../../lib/tenant';
import { list } from '../../lib/data';
import { Alert, Badge, Button, Input, Loading, Modal, PageHeader, Textarea, useAction, useAsync, useForm } from '../../components/ui';

const AUDIENCES = [ROLES.COLLEGE_ADMIN, ROLES.FACULTY, ROLES.STUDENT];

// audienceRoles only filters what each screen shows; it is not an access control.
export function AnnouncementList({ limitTo = 50 }) {
  const { iid, role } = useCtx();
  const { data, loading, error } = useAsync(
    () => list(query(tcol(iid, 'announcements'), where('status', '==', 'PUBLISHED'), orderBy('publishedAt', 'desc'), limit(limitTo))),
    [iid],
  );
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  const mine = data.filter((a) => !a.audienceRoles?.length || a.audienceRoles.includes(role) || isAdminRole(role));
  if (!mine.length) return <p className="muted">No announcements.</p>;
  return mine.map((a) => (
    <article key={a.id} style={{ marginBottom: 12 }}>
      <h3>{a.title}</h3>
      <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{a.body}</p>
    </article>
  ));
}

export default function Announcements() {
  const { role } = useCtx();
  if (!isAdminRole(role)) return <><PageHeader title="Announcements" /><AnnouncementList /></>;
  return <AdminAnnouncements />;
}

function AdminAnnouncements() {
  const { iid } = useCtx();
  const [editing, setEditing] = useState(null);
  const { data, loading, error, reload } = useAsync(() => list(query(tcol(iid, 'announcements'), orderBy('publishedAt', 'desc'), limit(50))), [iid]);
  const action = useAction();

  const toggle = (a) =>
    action.run(async () => {
      await updateDoc(tdoc(iid, 'announcements', a.id), { status: a.status === 'PUBLISHED' ? 'ARCHIVED' : 'PUBLISHED', updatedAt: serverTimestamp() });
      reload();
    });

  return (
    <>
      <PageHeader title="Announcements">
        <Button variant="primary" onClick={() => setEditing({})}>New announcement</Button>
      </PageHeader>
      <Alert kind="error">{error?.message || action.error}</Alert>
      {loading ? <Loading /> : data.map((a) => (
        <div className="card" key={a.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>{a.title} <Badge kind={a.status === 'PUBLISHED' ? 'ok' : ''}>{a.status}</Badge></h3>
            <div className="row">
              <Button small onClick={() => setEditing(a)}>Edit</Button>
              <Button small onClick={() => toggle(a)} disabled={action.busy}>{a.status === 'PUBLISHED' ? 'Archive' : 'Publish again'}</Button>
            </div>
          </div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{a.body}</p>
          <p className="muted">For: {a.audienceRoles?.length ? a.audienceRoles.join(', ') : 'everyone'}</p>
        </div>
      ))}
      {!loading && !data.length && <p className="muted">No announcements yet.</p>}
      {editing && <Editor a={editing} onClose={(saved) => { setEditing(null); if (saved) reload(); }} />}
    </>
  );
}

function Editor({ a, onClose }) {
  const { iid, uid } = useCtx();
  const { values, bind, set } = useForm({ title: a.title ?? '', body: a.body ?? '', audienceRoles: a.audienceRoles ?? [] });
  const { busy, error, run } = useAction();
  const toggleRole = (r) =>
    set((s) => ({ ...s, audienceRoles: s.audienceRoles.includes(r) ? s.audienceRoles.filter((x) => x !== r) : [...s.audienceRoles, r] }));

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const data = { title: values.title.trim(), body: values.body.trim(), audienceRoles: values.audienceRoles, updatedAt: serverTimestamp() };
      if (a.id) await updateDoc(tdoc(iid, 'announcements', a.id), data);
      else await addDoc(tcol(iid, 'announcements'), { ...data, status: 'PUBLISHED', publishedAt: serverTimestamp(), createdBy: uid, createdAt: serverTimestamp() });
      onClose(true);
    });
  };

  return (
    <Modal title={a.id ? 'Edit announcement' : 'New announcement'} onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid" style={{ flexDirection: 'column' }}>
          <Input label="Title" required {...bind('title')} />
          <Textarea label="Message" required {...bind('body')} />
          <fieldset>
            <legend>Show to (leave empty for everyone)</legend>
            {AUDIENCES.map((r) => (
              <label key={r} style={{ marginRight: 16 }}>
                <input type="checkbox" style={{ width: 18, minHeight: 18 }} checked={values.audienceRoles.includes(r)} onChange={() => toggleRole(r)} /> {r.replace('_', ' ').toLowerCase()}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Button variant="primary" type="submit" disabled={busy}>Save</Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
