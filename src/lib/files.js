import { doc, serverTimestamp, setDoc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { getToken } from 'firebase/app-check';
import { appCheck, auth } from './firebase';
import { tcol, tdoc } from './tenant';
import { list } from './data';

const BASE = import.meta.env.VITE_FILES_URL;
export const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png'];

// Where each kind of file lives. Slots (file IDs) are fixed so the rules cap files per folder.
export const KINDS = {
  students: { max: 1048576, slots: Array.from({ length: 20 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`) },
  faculty: { max: 1048576, slots: Array.from({ length: 20 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`) },
  teachingAssignments: { max: 2097152, slots: Array.from({ length: 100 }, (_, i) => `m${String(i + 1).padStart(3, '0')}`) },
};

export const listFiles = (iid, collection, ownerId) =>
  list(query(tcol(iid, collection, ownerId, 'documents'), orderBy('createdAt', 'desc')));

async function call(method, iid, collection, ownerId, docId, init = {}) {
  if (!BASE) throw new Error('The file service is not configured (VITE_FILES_URL).');
  const token = await auth.currentUser.getIdToken();
  // The Worker passes this on to Firestore, which refuses calls without it once App Check is enforced.
  const checked = appCheck ? { 'x-firebase-appcheck': (await getToken(appCheck)).token } : {};
  const res = await fetch(`${BASE}/files/${iid}/${collection}/${ownerId}/${docId}`, {
    method,
    ...init,
    headers: { authorization: `Bearer ${token}`, ...checked, ...init.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`File service: ${body.error ?? res.status}`);
  }
  return res;
}

export async function uploadFile({ iid, uid, collection, ownerId, file, title, kind, existing }) {
  const rule = KINDS[collection];
  if (!ACCEPT.includes(file.type)) throw new Error('Only PDF, JPEG or PNG files are allowed.');
  if (file.size > rule.max) throw new Error(`The file is too large (limit ${rule.max / 1048576} MB). Compress it first.`);
  const used = new Set(existing.map((d) => d.id));
  const docId = rule.slots.find((s) => !used.has(s));
  if (!docId) throw new Error('This folder is full. Remove a file first.');

  const ref = tdoc(iid, collection, ownerId, 'documents', docId);
  await setDoc(ref, {
    name: title || file.name, kind, objectKey: `${iid}/${collection}/${ownerId}/${docId}`, contentType: file.type,
    size: file.size, status: 'PENDING', uploadedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await call('PUT', iid, collection, ownerId, docId, { body: file, headers: { 'content-type': file.type } });
  await updateDoc(ref, { status: 'READY', updatedAt: serverTimestamp() });
}

export async function downloadFile(iid, collection, ownerId, d) {
  const res = await call('GET', iid, collection, ownerId, d.id);
  const url = URL.createObjectURL(await res.blob());
  // A typed title usually has no extension, and a file without one will not open.
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[d.contentType] ?? '';
  const download = d.name.toLowerCase().endsWith(ext) ? d.name : d.name + ext;
  const a = Object.assign(document.createElement('a'), { href: url, download });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Order matters: mark DELETED, let the Worker remove the object, then delete the metadata.
export async function removeFile(iid, collection, ownerId, d) {
  const ref = doc(tcol(iid, collection, ownerId, 'documents'), d.id);
  if (d.status !== 'DELETED') await updateDoc(ref, { status: 'DELETED', updatedAt: serverTimestamp() });
  await call('DELETE', iid, collection, ownerId, d.id);
  await deleteDoc(ref);
}
