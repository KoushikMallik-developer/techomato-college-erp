# Techomato Colleges

A multi-tenant college management system: students, faculty, academics, timetable, attendance, exams and results, announcements, and class materials. React + Vite on Firebase (Spark free plan, no Cloud Functions), with student files and class materials stored inside Firestore (900 KB each).

The specs are the source of truth: [product.md](product.md) (what) and [system_design.md](system_design.md) (how and why). [memory.md](memory.md) records decisions and known limits.

## How it is built

- **No backend code.** Firestore Security Rules ([firestore.rules](firestore.rules)) are the backend. Every college lives under `institutions/{id}/…`; rules check the user's college on every request.
- **Roles:** Platform Admin (SaaS owner, no access to college data), Super Admin, College Admin, Faculty, Student. Roles and `active` live in `users/{uid}`.
- **Files:** a file is a small metadata document plus a content document in Firestore. The same rules that guard the records decide who may read or write the bytes. Files are limited to 900 KB each, and big photos are shrunk in the browser.
- **Business rules** (attendance %, pass/fail, keys) are plain functions in [src/lib/calc.js](src/lib/calc.js) with unit tests.

## What is in it

| For | Features |
|---|---|
| Platform admin | Create and suspend colleges, add platform admins, change own password |
| College admins | Students, faculty, academics, timetable (no clashes, with **automatic generation**), attendance, exams and results, class materials, announcements, **requests inbox for students and faculty**, **library (books, copies, issue and return)**, **CSV import of students and faculty**, **promote a class**, **academic calendar and events**, users and audit log, **recent activity on the dashboard** |
| Faculty | Attendance, marks entry, class materials, timetable, calendar, library, leave requests and concerns, own documents |
| Students | Own attendance, results, timetable, calendar with sign-up, **leave requests and concerns**; the home page is the playful one (attendance ring, streak, badges) |
| Everyone | **Search** (press Ctrl K or /), **bell** that shows what is new, **light/dark theme switch**, installable and offline-friendly app shell |

Notes on the newer parts:

- **Automatic timetable** (Timetable, pick a section, "Generate automatically"): choose the school days, periods per day, the rooms (the first is the section's own) and classes per week for each active teaching assignment. It places classes so no teacher, room or section is double-booked, spreads each subject over the days, keeps days evenly loaded and avoids back-to-back repeats; it reads only the classes of the teachers and rooms involved, not the whole college. You see a preview and anything that does not fit before saving. By default only empty periods are filled; tick "Remove this section's current timetable first" to replace the week. Saving writes five classes per batch (rules allow about 20 lookups per batch); if someone books a room or teacher meanwhile, saving stops and says how many were saved, and generating again fills the rest. The result is a good greedy layout, not a proven best one; there are no per-teacher preferences, labs or consecutive-period rules.
- **Requests** (`requests/`): a student or faculty member files Leave or a Concern (at least 10 characters); an admin approves, rejects (a reason is required) or resolves it. An approved leave can be revoked with a reason. Overlapping waiting or approved leave is refused by the app (checked against the person's own list, not by the rules). Approving leave does not change attendance by itself.
- **Library** (`libraries/{id}`, `books/`, `bookCopies/`, `loans/`): off for a college until an admin opens Library and creates it (a name and the librarian's email). That also creates the librarian's login (role `LIBRARIAN`, a set-password email is sent); the librarian signs in and runs the library as the Library Operator, with no access to anything else. Admins can operate it too, and deactivate the librarian under Users. A college can have several libraries, each with its own librarian (one email runs one library) and its own books; accession codes are unique across the college. An admin can replace a library's librarian (the old login is blocked in the same save) and turn a library off and on (off freezes adding, issuing and returning and hides it from students; data is kept). Admins and the librarian add titles and physical copies (accession codes), issue a copy to a student by enrollment number (14 days, at most 3 books out per library) and take it back. A copy only becomes ON_LOAN together with a new loan, and back together with that loan being RETURNED, so two desks cannot issue the same copy. The "3 books" limit is checked by the app, not the rules, so two desks issuing at the very same moment could pass it. Fines are off (overdue loans are only flagged). The `available` and `copies` counts on a book are a display cache.
- **Import and promotion**: Students and Faculty have "Import CSV" (template download, row-by-row results, existing rows skipped). "Promote a class" completes one section's active enrollments and enrolls the students in a section of another semester. If saving stops part-way, run it again to move the rest.
- **Exports** neutralise cells that start with `=`, `+`, `-` or `@`.
- **Calendar** (`calendarEvents/`): admins write, everyone reads. An event can allow sign-ups (`rsvps/{uid}`). Deleting an event leaves its sign-ups behind (only their owners may delete them); they are unreachable and tiny.
- **Bell** (`readState/{uid}`): remembers when each person last looked. It does a few cheap reads on load and when opened, never a live listener, so it stays inside the free quota.
- **Search**: admins find students (name or enrollment number) and faculty by the start of the text, plus any page. Faculty and students search pages only. Firestore matches exactly, so a name is also tried with a capital first letter.
- **Offline**: a service worker keeps the app shell, so the page opens offline with a notice. Data is never cached by it, and saving needs a connection.
- Deploy the rules **and the indexes** (`npx firebase deploy --only "firestore"`): the requests screens need the new composite indexes.

## The public page

Visitors who are not signed in see a landing page at `/`; sign-in is at `/login`. It does not wait for Firebase before showing. Set `VITE_CONTACT_EMAIL` in `.env` to add a "Contact us" button (it is hidden when empty). The page makes no claims beyond what the app does and shows only labelled sample data.

## Run it locally

```bash
npm install
cp .env.example .env          # fill in your Firebase web config
npm run dev
```

To use the local emulators instead of a real project, set `VITE_USE_EMULATOR=true` in `.env`, then in another terminal:

```bash
npx firebase emulators:start --only auth,firestore --project demo-erp
GCLOUD_PROJECT=demo-erp FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  node scripts/create-platform-admin.js you@example.com "Your Name"
```

To fill the emulators with a demo college (principal, teacher, student, librarian with a library, attendance, an announcement), run this once the emulators are up. It refuses to run against a real project; every demo login uses the password `Passw0rd!`:

```bash
GCLOUD_PROJECT=demo-erp FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-demo.js
```

Logins: `principal@demo.test`, `teacher@demo.test`, `student@demo.test`, `librarian@demo.test`, and the platform admin `admin@techomato.local`.

Sign in as that Platform Admin, create a college (it creates the college's first Super Admin), then add departments, courses, subjects, years, semesters, sections, faculty and students.

## Tests

```bash
npm test             # business rules, dialog and error-boundary behaviour (no emulator needed)
npm run test:rules   # Security Rules, against the Firestore emulator (needs Java)
```

If `npm run test:rules` stops with "port taken", a Java emulator from an earlier run is still alive (seen on Windows). End that Java process, or change the port in `firebase.rules-test.json` (now 9393).

The rules tests cover tenant isolation, role limits, audit-entry reuse, attendance and marks ownership, timetable locks, enrollment-number uniqueness, file slots and status, and result privacy.

## Deploy

1. **Firebase (Spark):** create a project, enable Email/Password sign-in, create Firestore in production mode. Put the project ID in `.firebaserc` and the web config in `.env`. Then `npx firebase deploy --only firestore,hosting` after `npm run build`.
2. **Vercel (optional, instead of Firebase Hosting):** Firebase still provides Auth and Firestore, so deploy the rules with `npx firebase deploy --only "firestore"`. Import the repo in Vercel (framework Vite; [vercel.json](vercel.json) sets the build, the rewrite for page reloads and the security headers). Add the `VITE_*` values from `.env.example` under Project Settings, Environment Variables, with `VITE_USE_EMULATOR` set to `false`. Then add the Vercel domain in Firebase console, Authentication, Settings, Authorized domains, or sign-in fails. If you use App Check, register that domain for the reCAPTCHA key too.
3. **First Platform Admin:** run `scripts/create-platform-admin.js` with a service-account key stored outside this repo.
4. **App Check:** register the web app with reCAPTCHA v3 in the Firebase console and put the site key in `VITE_APPCHECK_SITE_KEY`. Watch it in monitor mode first. The Firebase SDK attaches the token to every Firestore call, so enforcing it later does not break file access. For local work, leave the site key empty in `.env` (reCAPTCHA only issues tokens for registered domains), or set a debug token in the browser as the Firebase App Check docs describe.
5. **Backups:** none, by decision. Spark has no managed backups.

## Limits you should know

- Files live in Firestore, so they share the 1 GiB limit with everything else: 2000 students with 3 files of 250 KB each would not fit. Keep documents optional, or move to Firebase Storage (Blaze plan).
- Spark's free daily quotas are shared by every college (20k writes a day for the whole project). Treat Spark as a one-college pilot; a real multi-college launch needs Blaze. Spread bulk marks entry and result publishing over several days.
- Without server code, a hostile staff member can burn the shared write quota, and rules cannot check that a student belongs to the section they are marked in. See the `shortcut:` notes in [system_design.md](system_design.md) for each limit and its upgrade path.
- One email address belongs to one college.
