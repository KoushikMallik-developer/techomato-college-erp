import { useRef, useState } from 'react';
import { deleteField, doc, getCountFromServer, getDoc, increment, limit, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCtx } from '../../app/AuthProvider';
import { tcol, tdoc, isAdminRole, ROLES } from '../../lib/tenant';
import { audit } from '../../lib/audit';
import { addDays, enrollmentKey, overdueDays } from '../../lib/calc';
import { createAuthUser, list, sendSetPasswordEmail } from '../../lib/data';
import { Alert, Badge, Button, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Textarea, toOptions, useAction, useAsync, useConfirm, useForm } from '../../components/ui';

const MAX_LOANS = 3; // active loans per student
const LOAN_DAYS = 14;
const day = (t) => t?.toDate?.().toLocaleDateString() ?? '';
const stamps = () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

export default function Library() {
  const { iid, uid, role, profile } = useCtx();
  const admin = isAdminRole(role);
  const ops = admin || role === ROLES.LIBRARIAN;
  const student = role === ROLES.STUDENT;
  const [tab, setTab] = useState('catalog');
  const [picked, setPicked] = useState('');
  const [dialog, setDialog] = useState(null); // 'new' | 'librarian'
  const [dismissed, setDismissed] = useState(false);
  const libs = useAsync(() => list(tcol(iid, 'libraries')), [iid]);
  const action = useAction();
  const confirm = useConfirm();

  if (libs.loading) return <Loading />;
  if (libs.error) return <Alert kind="error">{libs.error.message}</Alert>;
  // Admins see every library. A librarian sees their own. Everyone else sees the ones that are on.
  const visible = libs.data.filter((l) => (admin ? true : role === ROLES.LIBRARIAN ? l.id === profile.libraryId : l.status === 'ACTIVE'));
  const lib = visible.find((l) => l.id === picked) ?? visible[0];
  const done = (saved) => { setDialog(null); setDismissed(true); if (saved) libs.reload(); };
  const create = (admin && (dialog === 'new' || (!lib && !dismissed))) && <CreateLibrary onClose={done} />;

  if (!lib) {
    return (
      <>
        <PageHeader title="Library" />
        {admin ? (
          <>
            <p>Your college does not have a library yet. It needs to be created first.</p>
            <Button variant="primary" onClick={() => setDialog('new')}>Create the library</Button>
          </>
        ) : <p className="muted">The library is not set up for your college yet.</p>}
        {create}
      </>
    );
  }

  const off = lib.status === 'OFF';
  const switchOff = (status) =>
    action.run(async () => {
      const batch = writeBatch(db);
      audit(batch, { iid, uid }, status === 'OFF' ? 'LIBRARY_TURNED_OFF' : 'LIBRARY_TURNED_ON', 'libraries', lib.id, { name: lib.name });
      batch.update(tdoc(iid, 'libraries', lib.id), { status, updatedAt: serverTimestamp() });
      await batch.commit();
      libs.reload();
    });

  return (
    <>
      <PageHeader title={lib.name}>
        {admin && <Button onClick={() => setDialog('new')}>New library</Button>}
      </PageHeader>
      {admin && visible.length > 1 && <Select label="Library" value={lib.id} onChange={setPicked} options={toOptions(visible)} />}
      {admin && (
        <div className="row">
          <span className="muted">Librarian: {lib.librarianEmail}</span>
          <Button small onClick={() => setDialog('librarian')}>Replace librarian</Button>
          {off
            ? <Button small onClick={() => switchOff('ACTIVE')} disabled={action.busy}>Turn on</Button>
            : <Button small variant="danger" disabled={action.busy}
              onClick={() => confirm.ask({ title: `Turn off “${lib.name}”?`, body: 'Nothing can be added, issued or returned, and students stop seeing it. Books and loans are kept. You can turn it on again.', label: 'Turn off' }, () => switchOff('OFF'))}>Turn off</Button>}
        </div>
      )}
      <Alert kind="error">{action.error}</Alert>
      {off && <Alert kind="error">This library is turned off. {admin ? 'Turn it on to add, issue or return books.' : 'Ask the college admin.'}</Alert>}
      {(ops || student) && (
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'catalog', label: 'Books' }, { value: 'loans', label: ops ? 'Loans' : 'My loans' }]} />
      )}
      {tab === 'catalog' || !(ops || student)
        ? <Catalog key={lib.id} admin={ops && !off} libraryId={lib.id} />
        : ops ? <Loans key={lib.id} libraryId={lib.id} writable={!off} /> : <MyLoans />}
      {confirm.dialog}
      {create}
      {dialog === 'librarian' && <ReplaceLibrarian lib={lib} onClose={done} />}
    </>
  );
}

// An admin creates a library and its librarian's login together. The librarian gets an email to set a password, then
// signs in and works as that library's Library Operator.
function CreateLibrary({ onClose }) {
  const { iid, uid } = useCtx();
  const { values, bind } = useForm({ name: '', email: '' });
  const { busy, error, run } = useAction();
  const uids = useRef({}); // a retry reuses a login created by an attempt that failed later
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const email = values.email.trim().toLowerCase();
      const librarianUid = (uids.current[email] ??= await createAuthUser(email));
      const ref = doc(tcol(iid, 'libraries'));
      const batch = writeBatch(db);
      const auditId = audit(batch, { iid, uid }, 'LIBRARY_CREATED', 'libraries', ref.id, { name: values.name.trim(), librarian: email });
      batch.set(ref, { name: values.name.trim(), librarianEmail: email, librarianUid, status: 'ACTIVE', ...stamps() });
      batch.set(doc(db, 'users', librarianUid), {
        institutionId: iid, role: ROLES.LIBRARIAN, libraryId: ref.id, displayName: email.split('@')[0], email, active: true, auditId, ...stamps(),
      });
      await batch.commit();
      await sendSetPasswordEmail(email).catch(() => {});
      onClose(true);
    });
  };
  return (
    <Modal title="Create a library" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <p className="muted">A library needs a name and a librarian. The librarian gets an email to set a password, then signs in and runs that library. One email can run one library.</p>
        <div className="form-grid">
          <Input label="Library name" required maxLength={100} data-autofocus {...bind('name')} />
          <Input label="Librarian's email" type="email" required {...bind('email')} />
        </div>
        <div className="row">
          <Button onClick={() => onClose(false)}>Not now</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create library'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// The new librarian is created and the old login is blocked in one batch, so the library is never without a way in
// and never has two. The old librarian's loans and history stay.
function ReplaceLibrarian({ lib, onClose }) {
  const { iid, uid } = useCtx();
  const { values, bind } = useForm({ email: '' });
  const { busy, error, run } = useAction();
  const uids = useRef({});
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const email = values.email.trim().toLowerCase();
      if (email === lib.librarianEmail) throw new Error('That is already the librarian.');
      const librarianUid = (uids.current[email] ??= await createAuthUser(email));
      const batch = writeBatch(db);
      const auditId = audit(batch, { iid, uid }, 'LIBRARIAN_REPLACED', 'libraries', lib.id, { from: lib.librarianEmail, to: email });
      batch.set(doc(db, 'users', librarianUid), {
        institutionId: iid, role: ROLES.LIBRARIAN, libraryId: lib.id, displayName: email.split('@')[0], email, active: true, auditId, ...stamps(),
      });
      batch.update(doc(db, 'users', lib.librarianUid), { active: false, auditId, updatedAt: serverTimestamp() });
      batch.update(tdoc(iid, 'libraries', lib.id), { librarianEmail: email, librarianUid, updatedAt: serverTimestamp() });
      await batch.commit();
      await sendSetPasswordEmail(email).catch(() => {});
      onClose(true);
    });
  };
  return (
    <Modal title="Replace the librarian" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <p className="muted">{lib.librarianEmail} will no longer be able to sign in. The new librarian gets an email to set a password.</p>
        <Input label="New librarian's email" type="email" required data-autofocus {...bind('email')} />
        <div className="row">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Replace'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- catalog ---------------- */

function Catalog({ admin, libraryId }) {
  const { iid, uid } = useCtx();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null); // a book, or {} for a new one
  const [stocking, setStocking] = useState(null);
  const { data, loading, error, reload } = useAsync(() => list(query(tcol(iid, 'books'), where('libraryId', '==', libraryId), orderBy('title'), limit(300))), [iid, libraryId]);
  const action = useAction();
  const confirm = useConfirm();
  const needle = text.trim().toLowerCase();
  const rows = (data ?? []).filter((b) => (admin || b.status === 'ACTIVE')
    && (!needle || [b.title, b.author, b.isbn, b.category].some((v) => v?.toLowerCase().includes(needle))));

  const setStatus = (b, status) =>
    action.run(async () => {
      const batch = writeBatch(db);
      audit(batch, { iid, uid }, status === 'ARCHIVED' ? 'BOOK_ARCHIVED' : 'BOOK_RESTORED', 'books', b.id, { title: b.title });
      batch.update(tdoc(iid, 'books', b.id), { status, updatedAt: serverTimestamp() });
      await batch.commit();
      reload();
    });

  return (
    <>
      {admin && <div className="row"><Button variant="primary" onClick={() => setEditing({})}>Add book</Button></div>}
      <Input label="Search by title, author, ISBN or category" value={text} onChange={setText} />
      <Alert kind="error">{error?.message || action.error}</Alert>
      {loading ? <Loading /> : (
        <Table
          rows={rows}
          empty={needle ? 'No book matches.' : 'No books yet.'}
          columns={[
            { key: 'title', label: 'Title' },
            { key: 'author', label: 'Author' },
            { key: 'isbn', label: 'ISBN' },
            { key: 'category', label: 'Category' },
            { key: 'available', label: 'Available', render: (b) => (b.status === 'ARCHIVED' ? <Badge>archived</Badge> : `${b.available} of ${b.copies}`) },
          ]}
          actions={admin ? (b) => (
            <>
              <Button small onClick={() => setStocking(b)}>Add copies</Button>{' '}
              <Button small onClick={() => setEditing(b)}>Edit</Button>{' '}
              {b.status === 'ACTIVE'
                ? <Button small variant="danger" onClick={() => confirm.ask({ title: `Archive “${b.title}”?`, body: 'Students stop seeing it. Loans and history stay.', label: 'Archive' }, () => setStatus(b, 'ARCHIVED'))}>Archive</Button>
                : <Button small onClick={() => setStatus(b, 'ACTIVE')}>Restore</Button>}
            </>
          ) : undefined}
        />
      )}
      {confirm.dialog}
      {editing && <BookForm book={editing} libraryId={libraryId} onClose={(saved) => { setEditing(null); if (saved) reload(); }} />}
      {stocking && <AddCopies book={stocking} onClose={(saved) => { setStocking(null); if (saved) reload(); }} />}
    </>
  );
}

function BookForm({ book, libraryId, onClose }) {
  const { iid, uid } = useCtx();
  const isNew = !book.id;
  const { values, bind } = useForm({ title: book.title ?? '', author: book.author ?? '', isbn: book.isbn ?? '', category: book.category ?? '' });
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const fields = { title: values.title.trim(), author: values.author.trim(), isbn: values.isbn.trim(), category: values.category.trim() };
      const batch = writeBatch(db);
      const ref = isNew ? doc(tcol(iid, 'books')) : tdoc(iid, 'books', book.id);
      audit(batch, { iid, uid }, isNew ? 'BOOK_CREATED' : 'BOOK_UPDATED', 'books', ref.id, { title: fields.title });
      if (isNew) batch.set(ref, { ...fields, libraryId, status: 'ACTIVE', copies: 0, available: 0, ...stamps() });
      else batch.update(ref, { ...fields, updatedAt: serverTimestamp() });
      await batch.commit();
      onClose(true);
    });
  };
  return (
    <Modal title={isNew ? 'Add book' : 'Edit book'} onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Title" required maxLength={200} {...bind('title')} />
          <Input label="Author" maxLength={120} {...bind('author')} />
          <Input label="ISBN" maxLength={20} hint="Kept as text, so leading zeros stay." {...bind('isbn')} />
          <Input label="Category" maxLength={60} {...bind('category')} />
        </div>
        <div className="row">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// One physical copy has its own accession code (its label in the library). A title can have many.
function AddCopies({ book, onClose }) {
  const { iid, uid } = useCtx();
  const [codes, setCodes] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const list_ = [...new Set(codes.split('\n').map((c) => c.trim().toUpperCase()).filter(Boolean))];
      if (!list_.length) throw new Error('Type at least one accession code.');
      if (list_.length > 50) throw new Error('Add at most 50 copies at a time.');
      const bad = list_.find((c) => !/^[A-Z0-9._-]{1,30}$/.test(c));
      if (bad) throw new Error(`“${bad}” is not a valid code. Use letters, numbers, dots, dashes or underscores.`);
      const batch = writeBatch(db);
      list_.forEach((c) => batch.set(tdoc(iid, 'bookCopies', c), { libraryId: book.libraryId, bookId: book.id, status: 'AVAILABLE', ...stamps() }));
      batch.update(tdoc(iid, 'books', book.id), { copies: increment(list_.length), available: increment(list_.length), updatedAt: serverTimestamp() });
      audit(batch, { iid, uid }, 'COPIES_ADDED', 'books', book.id, { count: list_.length });
      try { await batch.commit(); } catch (err) {
        if (err.code === 'permission-denied') throw new Error('Nothing was added. One of these codes may already exist.');
        throw err;
      }
      onClose(true);
    });
  };
  return (
    <Modal title={`Add copies of “${book.title}”`} onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <Textarea label="Accession codes, one per line" required value={codes} onChange={setCodes} />
        <p className="muted">Each code must be new. If one already exists, none are added.</p>
        <div className="row">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add copies'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- loans ---------------- */

function dueBadge(loan, today) {
  if (loan.status === 'RETURNED') return <Badge>returned {day(loan.returnedAt)}</Badge>;
  const late = overdueDays(loan.dueDate, today);
  return late ? <Badge kind="bad">{late} {late === 1 ? 'day' : 'days'} overdue</Badge> : <Badge kind="ok">on loan</Badge>;
}

function MyLoans() {
  const { iid, profile, today } = useCtx();
  const { data, loading, error } = useAsync(
    () => list(query(tcol(iid, 'loans'), where('studentId', '==', profile.studentId), orderBy('issuedAt', 'desc'), limit(50))), [iid],
  );
  if (loading) return <Loading />;
  return (
    <>
      <Alert kind="error">{error?.message}</Alert>
      <Table
        rows={data}
        empty="You have not borrowed anything yet."
        columns={[
          { key: 'bookTitle', label: 'Book' },
          { key: 'issuedAt', label: 'Borrowed', render: (l) => day(l.issuedAt) },
          { key: 'dueDate', label: 'Due' },
          { key: 'status', label: 'Status', render: (l) => dueBadge(l, today()) },
        ]}
      />
      <p className="muted">You can borrow up to {MAX_LOANS} books for {LOAN_DAYS} days. There are no fines in this system; the library will remind you.</p>
    </>
  );
}

function Loans({ libraryId, writable }) {
  const { iid, uid, today } = useCtx();
  const [issuing, setIssuing] = useState(false);
  const { data, loading, error, reload } = useAsync(
    () => list(query(tcol(iid, 'loans'), where('libraryId', '==', libraryId), where('status', '==', 'ACTIVE'), orderBy('issuedAt', 'desc'), limit(100))), [iid, libraryId],
  );
  const action = useAction();
  const confirm = useConfirm();

  const giveBack = (loan) =>
    action.run(async () => {
      const batch = writeBatch(db);
      batch.update(tdoc(iid, 'loans', loan.id), { status: 'RETURNED', returnedAt: serverTimestamp(), returnedBy: uid, updatedAt: serverTimestamp() });
      batch.update(tdoc(iid, 'bookCopies', loan.copyId), { status: 'AVAILABLE', loanId: deleteField(), updatedAt: serverTimestamp() });
      batch.update(tdoc(iid, 'books', loan.bookId), { available: increment(1), updatedAt: serverTimestamp() });
      audit(batch, { iid, uid }, 'BOOK_RETURNED', 'loans', loan.id, { copy: loan.copyId });
      try { await batch.commit(); } catch (err) {
        if (err.code === 'permission-denied') { reload(); throw new Error('This loan may already be closed. The list was refreshed.'); }
        throw err;
      }
      reload();
    }, 'Book returned.');

  return (
    <>
      {writable && <div className="row"><Button variant="primary" onClick={() => setIssuing(true)}>Issue a book</Button></div>}
      <Alert kind="error">{error?.message || action.error}</Alert>
      <Alert kind="ok">{action.done}</Alert>
      {loading ? <Loading /> : (
        <Table
          rows={data}
          empty="Nothing is out on loan."
          columns={[
            { key: 'bookTitle', label: 'Book' },
            { key: 'copyId', label: 'Copy' },
            { key: 'studentName', label: 'Borrower' },
            { key: 'issuedAt', label: 'Issued', render: (l) => day(l.issuedAt) },
            { key: 'dueDate', label: 'Due' },
            { key: 'status', label: 'Status', render: (l) => dueBadge(l, today()) },
          ]}
          actions={writable ? (l) => (
            <Button small disabled={action.busy}
              onClick={() => confirm.ask({ title: 'Mark as returned?', body: `${l.bookTitle} (${l.copyId}) from ${l.studentName}.`, label: 'Returned', danger: false }, () => giveBack(l))}>Returned</Button>
          ) : undefined}
        />
      )}
      <p className="muted">Loans last {LOAN_DAYS} days. Fines are off until the college decides a rate; overdue loans are only flagged here.</p>
      {confirm.dialog}
      {issuing && <Issue libraryId={libraryId} onClose={(saved) => { setIssuing(false); if (saved) reload(); }} />}
    </>
  );
}

function Issue({ libraryId, onClose }) {
  const { iid, uid, today } = useCtx();
  const { values, bind } = useForm({ code: '', number: '' });
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const code = values.code.trim().toUpperCase();
      const copy = (await getDoc(tdoc(iid, 'bookCopies', code))).data();
      if (!copy) throw new Error('No copy has that accession code.');
      if (copy.libraryId !== libraryId) throw new Error('That copy belongs to another library.');
      if (copy.status !== 'AVAILABLE') throw new Error(`That copy is ${copy.status === 'ON_LOAN' ? 'already on loan' : copy.status.toLowerCase()}.`);
      const index = (await getDoc(tdoc(iid, 'enrollmentNumberIndex', enrollmentKey(values.number)))).data();
      if (!index) throw new Error('No student has that enrollment number.');
      const student = (await getDoc(tdoc(iid, 'students', index.studentId))).data();
      if (student.status !== 'ACTIVE') throw new Error('That student is not active.');
      const out = (await getCountFromServer(query(tcol(iid, 'loans'), where('libraryId', '==', libraryId), where('studentId', '==', index.studentId), where('status', '==', 'ACTIVE')))).data().count;
      if (out >= MAX_LOANS) throw new Error(`${student.name} already has ${out} books out from this library. The limit is ${MAX_LOANS}.`);
      const book = (await getDoc(tdoc(iid, 'books', copy.bookId))).data();

      const loanRef = doc(tcol(iid, 'loans'));
      const batch = writeBatch(db);
      batch.set(loanRef, {
        libraryId, copyId: code, bookId: copy.bookId, bookTitle: book.title, studentId: index.studentId, studentName: student.name,
        issuedAt: serverTimestamp(), dueDate: addDays(today(), LOAN_DAYS), issuedBy: uid, status: 'ACTIVE', ...stamps(),
      });
      batch.update(tdoc(iid, 'bookCopies', code), { status: 'ON_LOAN', loanId: loanRef.id, updatedAt: serverTimestamp() });
      batch.update(tdoc(iid, 'books', copy.bookId), { available: increment(-1), updatedAt: serverTimestamp() });
      audit(batch, { iid, uid }, 'BOOK_ISSUED', 'loans', loanRef.id, { copy: code, student: student.name });
      try { await batch.commit(); } catch (err) {
        // The copy changed while we were reading it: another desk got there first.
        if (err.code === 'permission-denied') throw new Error('That copy was just issued somewhere else. Check the loans list.');
        throw err;
      }
      onClose(true);
    });
  };
  return (
    <Modal title="Issue a book" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Accession code of the copy" required data-autofocus {...bind('code')} />
          <Input label="Student's enrollment number" required {...bind('number')} />
        </div>
        <p className="muted">Due in {LOAN_DAYS} days. A student can have {MAX_LOANS} books out at once.</p>
        <div className="row">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Issuing…' : 'Issue'}</Button>
        </div>
      </form>
    </Modal>
  );
}
