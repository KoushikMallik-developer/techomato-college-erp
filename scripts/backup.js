// Incremental backup for one college at a time (Spark has no managed backups).
// Usage: node scripts/backup.js --institution <id> [--max-reads 15000] [--out backups]
// Needs GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key stored OUTSIDE the repo.
// Exports only documents changed since the last run, and stops near the read budget; run again to continue.
import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const iid = arg('institution');
const maxReads = Number(arg('max-reads', 15000));
const outRoot = arg('out', 'backups');
if (!iid) {
  console.error('Usage: node scripts/backup.js --institution <id>');
  process.exit(1);
}

admin.initializeApp();
const db = admin.firestore();
const dir = path.join(outRoot, iid);
fs.mkdirSync(dir, { recursive: true });
const statePath = path.join(dir, 'state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { since: {} };

const COLLECTIONS = [
  'departments', 'courses', 'subjects', 'academicYears', 'semesters', 'sections', 'students',
  'faculty', 'enrollments', 'teachingAssignments', 'timetableSlots', 'timetableLocks',
  'enrollmentNumberIndex', 'studentAttendance', 'classSessions', 'facultyAttendance', 'exams',
  'examSubjects', 'studentMarks', 'results', 'announcements', 'auditLogs',
];

let reads = 0;
const stamp = new Date().toISOString().replaceAll(':', '-');
const outFile = path.join(dir, `${stamp}.jsonl`);
const out = fs.createWriteStream(outFile);

async function exportQuery(label, query, sinceKey) {
  const since = state.since[sinceKey];
  let q = query.orderBy('updatedAt');
  if (since) q = q.startAfter(admin.firestore.Timestamp.fromMillis(since));
  let last = since;
  while (reads < maxReads) {
    const snap = await q.limit(500).get();
    reads += snap.size;
    for (const d of snap.docs) {
      out.write(JSON.stringify({ path: d.ref.path, data: d.data() }) + '\n');
      last = d.get('updatedAt')?.toMillis?.() ?? last;
    }
    if (snap.size < 500) { state.since[sinceKey] = last; return true; }
    q = query.orderBy('updatedAt').startAfter(snap.docs.at(-1).get('updatedAt'));
    state.since[sinceKey] = last;
  }
  console.log(`Read budget reached in ${label}; run again to continue.`);
  return false;
}

// File metadata lives in subcollections named "documents". They are matched to this college by
// objectKey prefix. shortcut: only new files are picked up; later status changes are not re-exported.
async function exportFileMetadata() {
  let q = db.collectionGroup('documents')
    .where('objectKey', '>=', `${iid}/`).where('objectKey', '<', `${iid}0`).orderBy('objectKey');
  if (state.lastFileKey) q = q.startAfter(state.lastFileKey);
  while (reads < maxReads) {
    const snap = await q.limit(500).get();
    reads += snap.size;
    for (const d of snap.docs) {
      out.write(JSON.stringify({ path: d.ref.path, data: d.data() }) + '\n');
      state.lastFileKey = d.get('objectKey');
    }
    if (snap.size < 500) return;
    q = q.startAfter(state.lastFileKey);
  }
}

const college = db.doc(`institutions/${iid}`);
out.write(JSON.stringify({ path: college.path, data: (await college.get()).data() }) + '\n');
reads++;

let complete = true;
for (const name of COLLECTIONS) {
  if (!(await exportQuery(name, college.collection(name), name))) { complete = false; break; }
}
if (complete) {
  // Needs a composite index (institutionId + updatedAt); Firestore prints the link on first run.
  await exportQuery('users', db.collection('users').where('institutionId', '==', iid), 'users');
}
if (complete) await exportFileMetadata();

out.end();
fs.writeFileSync(statePath, JSON.stringify(state));
console.log(`${complete ? 'Done' : 'Partial'}: ${reads} reads, written to ${outFile}`);
