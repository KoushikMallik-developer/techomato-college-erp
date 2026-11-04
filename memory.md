# Project memory — Techomato Colleges

Notes on decisions and state, so a new session can continue without re-deriving them. The specs are [product.md](product.md) and [system_design.md](system_design.md). This file does not repeat them; it records why things are the way they are.

## State
- The app is built (React + Vite, `firestore.rules`, `scripts/`). It is a git repo with one local commit; nothing is pushed.
- Verified: `npm test` (unit and component tests), `npm run test:rules` (Security Rules tests on the Firestore emulator, including a 60-student attendance batch), and `vite build`.
- Not verified: the UI has never been opened in a browser against a real or emulated project, and the quota numbers are estimates.
- Rules fixes found while building: students must fetch results by ID (`{examId}_{studentId}`), because rules do not filter queries and a query touching a draft result is rejected whole.
- `firebase emulators:exec` leaves a Java process holding its port after a run (killing it was not permitted). The rules tests use `firebase.rules-test.json`; if the port is taken, change the number there (now 8383).

## Decisions the user made
- **Multi-tenant SaaS.** Many colleges share one Firebase project. Each college's data lives under `institutions/{institutionId}/…`. One email belongs to one college.
- **Firebase Spark (free) plan.** No Cloud Functions, so the "backend" is Firestore Security Rules plus client batches.
- **No payment system.** The whole Fees module, receipts and the Accountant role were removed. Subscription billing is out of scope; the Platform Admin creates and suspends colleges by hand.
- **Files are stored inside Firestore** (decided: the user chose "only Firebase, stay on Spark" over Firebase Storage, which needs Blaze). Each file is a metadata document plus a content document holding `bytes`, 900 KB max, slots f01-f05 / m01-m20. Cloudflare R2 and its Worker were removed.
- **File features:** student documents (admins upload), faculty's own documents, and class materials (a teacher uploads for a class they teach; enrolled students read).

- **Landing page** at `/` for visitors (plain CSS, `src/features/landing/`), sign-in at `/login`. It renders without waiting for Firebase auth. No testimonials or statistics (none exist); the hero illustration is labelled sample data.

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
- Marks rules do not check that a student is enrolled in the section (one lookup per student). The publish screen flags marks under the wrong section and an admin removes them. Attendance records do check enrollment on creation; the register saves in groups of about 14 lookups because one batch allows about 20 (measured: 17 distinct lookups pass, 18 fail).
- No backups, by decision (the user said they are not needed). Spark has none managed. The backup script and its indexes were removed.
- Auth accounts cannot be disabled from the client; deactivation is enforced by `active` in rules only. A hostile admin can squat another college's email addresses.

## Open items
- Firebase Storage needs Blaze. Files in Firestore share the 1 GiB limit (2000 students x 3 files x 250 KB would not fit). Decide whether that is enough or the project moves to Blaze.
- Verify in the Firebase emulator: rule syntax (`diff().affectedKeys()`, `getAfter`, `matches()`, `let` in functions, nested functions), and that batches stay inside the per-request lookup limits (60-student attendance batch, 3-lock timetable save, 500-document result chunk).
- Confirm Spark's free quota reset time (believed to be midnight Pacific).
- Check whether turning off Auth sign-up would also block the admin's secondary-app account creation.

## How the user works with me
- They ask for a review (`/ponytail:ponytail-review`), then say "fix all", then ask for another review. Each cycle has found fewer and smaller issues.
- They want plain English and short answers. Reviews list findings in Must fix / Should fix / Nice to have, numbered.
- Claims in my summaries must be accurate. I once overclaimed that file slots stop a write flood, and the review caught it.

## Features added after the first release
- **Decided:** the user asked for "maximum features" and chose student requests, calendar and events, search and everyday tools, and more playful student pages. Reports/printing and bulk import were offered and not chosen; fees and payments stay out.
- Requests (leave and concerns), calendar with sign-up, notification bell, search palette (Ctrl K), light/dark switch, activity feed, offline shell, playful student home (ring, streak, badges, mascot).
- **Homework (assignments with answers and grading) was built, then removed on the user's request.** Nothing of it is left in the app, rules, indexes or tests; it was never deployed.
- Shortcuts: leave approval does not touch attendance; event deletion leaves its sign-ups; the bell counts announcements by reading the latest 10; Firestore offline persistence is NOT on (stale records would be worse than a notice).
- `scripts/seed-demo.js` fills the emulators with demo data. The Playwright project `techomato-college-erp-test` has a `local` project that walks these flows against the emulators.
- Run `npm test` and `npm run test:rules` for the current counts. The rules test port keeps moving (see `firebase.rules-test.json`) because the emulator leaks its port.
- **Automatic timetable:** `generateTimetable` in `src/lib/calc.js` (pure, 5 unit tests) plus the Generate dialog in `Timetable.jsx`. Greedy with seeded retries; fills free periods or replaces a section's week; saved 5 classes per batch. Rules tests cover a 5-class batch, a clashing batch failing whole, and removal freeing the locks.

## PRD review follow-up (library, requests, import)

- Built after comparing with `College_ERP_MERN_PRD.md`: faculty requests, leave rules (overlap, reject reason, revoke, 10-character minimum), CSV import for students and faculty, promote a class, library, results-published notice in the bell, self-service password change, roster/leave exports, CSV formula guard, a reason when results are unpublished.
- Already matched the PRD, no change: attendance percentage (no records is shown as a dash, leave is not counted), absent kept apart from zero marks, audited attendance corrections for faculty.
- Not built, on purpose: void of an attendance register (rules forbid removing records), keeping old results visible while corrected (students see nothing while a result is unpublished), subject-offering history with effective dates, web push, migration, backups.
- Library rule limits: the 3-loan limit is a client check; `available` and `copies` on a book are a cache.
- Library is opt-in per college: an admin creates `libraries/{id}` (several allowed), which also creates that library's LIBRARIAN user (`users.libraryId`). Rules scope books, copies and loans by `libraryId`; status OFF freezes writes. Replace-librarian blocks the old login in the same batch. Accession codes are unique college-wide. Libraries made with the earlier single-library build (`libraries/main`, no `libraryId` on books) would need a one-off fix; none were deployed.
