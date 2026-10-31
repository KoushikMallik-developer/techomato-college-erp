import { Bytes, deleteDoc, getDoc, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { tcol, tdoc } from './tenant';
import { list } from './data';

export const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png'];
// Files live inside Firestore documents (1 MiB limit each), so a file may not exceed this.
export const MAX_BYTES = 921600;

const slots = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
// Fixed slot ids: the rules cap how many files a folder can hold.
export const SLOTS = { students: slots('f', 5), faculty: slots('f', 5), teachingAssignments: slots('m', 20) };

export const listFiles = (iid, collection, ownerId) =>
  list(query(tcol(iid, collection, ownerId, 'documents'), orderBy('createdAt', 'desc')));

const metaRef = (iid, collection, ownerId, docId) => tdoc(iid, collection, ownerId, 'documents', docId);
const contentRef = (iid, collection, ownerId, docId) => tdoc(iid, collection, ownerId, 'documents', docId, 'content', 'data');

// Phone photos are several MB. Shrink big images in the browser so they fit; PDFs cannot be shrunk.
async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || file.size <= 600 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale),
  });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
}

export async function uploadFile({ iid, uid, collection, ownerId, file, title, kind, existing }) {
  if (!ACCEPT.includes(file.type)) throw new Error('Only PDF, JPEG or PNG files are allowed.');
  const blob = await shrinkImage(file);
  if (blob.size > MAX_BYTES) throw new Error(`The file is too large (limit ${Math.round(MAX_BYTES / 1024)} KB). Compress it first.`);
  const used = new Set(existing.map((d) => d.id));
  const docId = SLOTS[collection].find((s) => !used.has(s));
  if (!docId) throw new Error('This folder is full. Remove a file first.');

  // Order: metadata (PENDING) -> bytes -> READY. A failed upload leaves a PENDING record that can be removed.
  const meta = metaRef(iid, collection, ownerId, docId);
  await setDoc(meta, {
    name: title || file.name, kind, contentType: blob.type, size: blob.size, status: 'PENDING', uploadedBy: uid,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await setDoc(contentRef(iid, collection, ownerId, docId), { bytes: Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer())) });
  await updateDoc(meta, { status: 'READY', updatedAt: serverTimestamp() });
}

export async function downloadFile(iid, collection, ownerId, d) {
  const snap = await getDoc(contentRef(iid, collection, ownerId, d.id));
  if (!snap.exists()) throw new Error('This file has no content. Ask for it to be uploaded again.');
  const url = URL.createObjectURL(new Blob([snap.data().bytes.toUint8Array()], { type: d.contentType }));
  // A typed title usually has no extension, and a file without one will not open.
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[d.contentType] ?? '';
  const download = d.name.toLowerCase().endsWith(ext) ? d.name : d.name + ext;
  const a = Object.assign(document.createElement('a'), { href: url, download });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Order matters: mark DELETED, then delete the bytes and the record together.
export async function removeFile(iid, collection, ownerId, d) {
  if (d.status !== 'DELETED') await updateDoc(metaRef(iid, collection, ownerId, d.id), { status: 'DELETED', updatedAt: serverTimestamp() });
  const batch = writeBatch(db);
  batch.delete(contentRef(iid, collection, ownerId, d.id));
  batch.delete(metaRef(iid, collection, ownerId, d.id));
  await batch.commit();
}
