# Project memory — Techomato College ERP

Notes on decisions and state, so a new session can continue without re-deriving them. The specs are [product.md](product.md) and [system_design.md](system_design.md). This file does not repeat them; it records why things are the way they are.

## State
- The app is built (React + Vite, `firestore.rules`, `worker/`, `scripts/`). It is a git repo with one local commit; nothing is pushed.
- Verified: `npm test` (18 unit and Worker tests), `npm run test:rules` (34 Security Rules tests on the Firestore emulator, including a 60-student attendance batch), and `vite build`.
- Not verified: the UI has never been opened in a browser against a real or emulated project, the Worker has not run on Cloudflare, and the quota numbers are estimates.
- Rules fixes found while building: students must fetch results by ID (`{examId}_{studentId}`), because rules do not filter queries and a query touching a draft result is rejected whole.
- The Firestore emulator port 8080 may be held by a leftover process; rules tests use `firebase.rules-test.json` (port 8181) to avoid it.

## Decisions the user made
- **Multi-tenant SaaS.** Many colleges share one Firebase project. Each college's data lives under `institutions/{institutionId}/…`. One email belongs to one college.
- **Firebase Spark (free) plan.** No Cloud Functions, so the "backend" is Firestore Security Rules plus client batches.
- **No payment system.** The whole Fees module, receipts and the Accountant role were removed. Subscription billing is out of scope; the Platform Admin creates and suspends colleges by hand.
- **Files go to Cloudflare R2 behind a Cloudflare Worker**, not Google Drive and not Firebase Storage. The Worker forwards the caller's Firebase token to Firestore, and the Security Rules decide who may open a file.
- **File features:** student documents (admins upload), faculty's own documents, and class materials (a teacher uploads for a class they teach; enrolled students read).

## Decisions I made and the user did not object to
- Faculty uploading into a specific student's record was **not** added. Rules cannot check "this is my student", so any faculty member could upload to any student.
- "No payment system" was read as removing all fee tracking, not only payments.
- Roles: `PLATFORM_ADMIN` (SaaS owner, no access to college data), `SUPER_ADMIN`, `COLLEGE_ADMIN`, `FACULTY`, `STUDENT`. Roles live in `users/{uid}`, not custom claims.

## Design choices that look odd but are deliberate
- Attendance is one document per student per teaching assignment, holding a map of `d{YYYYMMDD}_{period}` → status. One document per session would fill the free 1 GiB in 3–4 months.
- A replaced teacher gets a **new** teaching assignment; the old one is set inactive. Never edit `teachingAssignments.facultyId`.
- Unique values (enrollment numbers, timetable clashes) use create-only index or lock documents written in the same batch.
- Edits to existing attendance, user changes and deactivation need a **new** audit entry in the same batch. Reusing an old entry is rejected.
- File IDs are fixed slots (`f01`–`f20`, `m001`–`m100`). The slots cap stored records, **not** write counts.
- Results are published by one write: draft `results` are written first, then `exams.status` flips to `PUBLISHED`.

## Known limits (all written into system_design.md as shortcuts)
- Spark's quotas are shared by all colleges: 20k writes a day for the whole project. One college of about 2000 students uses about half on a normal day and can exceed it on a marks-entry day. Spark fits a one-college pilot; a real multi-college launch needs Blaze.
- Rules cannot rate-limit an allowed user, so a hostile staff member could use up the shared write quota. App Check and watching usage are the only brakes.
- Rules do not check that a student is enrolled in the section for attendance or marks (one lookup per student would break the lookup limit).
- The backup is a local incremental script; Spark has no managed backups. A full export of one busy college is more than the daily read quota.
- Auth accounts cannot be disabled from the client; deactivation is enforced by `active` in rules only. A hostile admin can squat another college's email addresses.

## Open items
- Cloudflare R2: does enabling it need a payment method, and what are the current free limits (about 10 GB storage, Workers free plan request cap)? If it needs a card the user cannot add, STU-03 and class materials move out of the MVP.
- Verify in the Firebase emulator: rule syntax (`diff().affectedKeys()`, `getAfter`, `matches()`, `let` in functions, nested functions), and that batches stay inside the per-request lookup limits (60-student attendance batch, 3-lock timetable save, 500-document result chunk).
- Confirm Spark's free quota reset time (believed to be midnight Pacific).
- Check whether turning off Auth sign-up would also block the admin's secondary-app account creation.

## How the user works with me
- They ask for a review (`/ponytail:ponytail-review`), then say "fix all", then ask for another review. Each cycle has found fewer and smaller issues.
- They want plain English and short answers. Reviews list findings in Must fix / Should fix / Nice to have, numbered.
- Claims in my summaries must be accurate. I once overclaimed that file slots stop a write flood, and the review caught it.
