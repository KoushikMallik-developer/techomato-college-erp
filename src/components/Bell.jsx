import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Timestamp, getCountFromServer, getDoc, limit, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { useCtx } from '../app/AuthProvider';
import { tcol, tdoc, isAdminRole, ROLES } from '../lib/tenant';
import { list } from '../lib/data';
import { stash } from '../lib/stash';
import { Button, Modal } from './ui';
import { Icon } from './widgets';

const WEEK = 7 * 24 * 3600 * 1000;
const count = async (q) => (await getCountFromServer(q)).data().count;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What is new since this user last looked. A few cheap reads on load and when the bell opens, never a listener.
async function loadNotices({ iid, uid, role, profile }) {
  const seen = (await getDoc(tdoc(iid, 'readState', uid))).data() ?? {};
  // A first-time user sees the last week as new, not the whole history.
  const since = (key) => seen[key]?.toDate?.() ?? new Date(Date.now() - WEEK);
  const admin = isAdminRole(role);
  const items = [];

  const recent = await list(query(tcol(iid, 'announcements'), where('status', '==', 'PUBLISHED'), orderBy('publishedAt', 'desc'), limit(3)));
  const fresh = recent.filter((a) => a.publishedAt?.toDate() > since('announcementsSeenAt')
    && (admin || !a.audienceRoles?.length || a.audienceRoles.includes(role)));
  if (fresh.length) items.push({ key: 'announcementsSeenAt', to: '/announcements', n: fresh.length, text: `${plural(fresh.length, 'new announcement', 'new announcements')}${fresh.length === 3 ? ' or more' : ''}` });

  const events = await count(query(tcol(iid, 'calendarEvents'), where('createdAt', '>', Timestamp.fromDate(since('eventsSeenAt')))));
  if (events) items.push({ key: 'eventsSeenAt', to: '/calendar', n: events, text: plural(events, 'new calendar event', 'new calendar events') });

  if (admin) {
    const pending = await count(query(tcol(iid, 'requests'), where('status', '==', 'PENDING')));
    if (pending) items.push({ to: '/requests', n: pending, text: plural(pending, 'request waiting for you', 'requests waiting for you') });
  } else if (role === ROLES.STUDENT || role === ROLES.FACULTY) {
    const mine = role === ROLES.STUDENT ? ['studentId', profile.studentId] : ['facultyId', profile.facultyId];
    const decided = await count(query(tcol(iid, 'requests'), where(mine[0], '==', mine[1]), where('decidedAt', '>', Timestamp.fromDate(since('requestsSeenAt')))));
    if (decided) items.push({ key: 'requestsSeenAt', to: '/requests', n: decided, text: plural(decided, 'request answered', 'requests answered') });
    if (role === ROLES.STUDENT) {
      // publishedAt is cleared when results are unpublished, so only live results count.
      // Only the student's own semester counts, not every exam in the college.
      const [enrolled] = await list(query(tcol(iid, 'enrollments'), where('studentId', '==', profile.studentId), where('status', '==', 'ACTIVE'), limit(1)));
      const results = enrolled ? await count(query(tcol(iid, 'exams'), where('semesterId', '==', enrolled.semesterId), where('publishedAt', '>', Timestamp.fromDate(since('resultsSeenAt'))))) : 0;
      if (results) items.push({ key: 'resultsSeenAt', to: '/exams', n: results, text: plural(results, 'new result published', 'new results published') });
    }
  }
  return items;
}

export default function Bell() {
  const ctx = useCtx();
  const { iid, uid } = ctx;
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  // Page loads reuse the last answer for 10 minutes (per tab); opening the bell always asks again.
  const memo = `bell:${uid}`;
  const refresh = useCallback(async (fresh = false) => {
    try {
      const hit = fresh ? null : stash.get(memo);
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) { setItems(hit.items); return; }
      const found = await loadNotices(ctx);
      setItems(found);
      stash.set(memo, { at: Date.now(), items: found });
      setError('');
    } catch (e) { setError('Could not check for news.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iid, uid]);
  useEffect(() => { refresh(); }, [refresh]);

  const markSeen = async (keys) => {
    const fields = Object.fromEntries([...new Set(keys.filter(Boolean))].map((k) => [k, serverTimestamp()]));
    if (!Object.keys(fields).length) return;
    await setDoc(tdoc(iid, 'readState', uid), { ...fields, updatedAt: serverTimestamp() }, { merge: true });
    stash.drop(memo);
  };
  const visit = async (item) => {
    setOpen(false);
    setItems((all) => all.filter((x) => x !== item));
    await markSeen([item.key]).catch(() => {});
  };
  const clear = async () => {
    await markSeen(items.map((x) => x.key)).catch(() => {});
    setItems((all) => all.filter((x) => !x.key));
  };
  const total = items.reduce((n, x) => n + x.n, 0);

  return (
    <>
      <button type="button" className="icon-btn bell" onClick={() => { setOpen(true); refresh(true); }}
        aria-label={total ? `Notifications, ${total} new` : 'Notifications'}>
        <Icon d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        {total > 0 && <span className="bell-count" aria-hidden="true">{total > 9 ? '9+' : total}</span>}
      </button>
      {open && (
        <Modal title="What's new" onClose={() => setOpen(false)}>
          {error && <p className="muted">{error}</p>}
          {!items.length && !error && <p className="muted">You are all caught up.</p>}
          <ul className="notices">
            {items.map((item) => (
              <li key={item.to}>
                <Link to={item.to} onClick={() => visit(item)}>{item.text}</Link>
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            {items.some((x) => x.key) && <Button onClick={clear}>Mark all as read</Button>}
            <Button variant="primary" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
