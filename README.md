# Techomato College ERP

A multi-tenant college management system: students, faculty, academics, timetable, attendance, exams and results, announcements, and class materials. React + Vite on Firebase (Spark free plan, no Cloud Functions), with student files in a private Cloudflare R2 bucket behind a small Worker.

The specs are the source of truth: [product.md](product.md) (what) and [system_design.md](system_design.md) (how and why). [memory.md](memory.md) records decisions and known limits.

## How it is built

- **No backend code.** Firestore Security Rules ([firestore.rules](firestore.rules)) are the backend. Every college lives under `institutions/{id}/…`; rules check the user's college on every request.
- **Roles:** Platform Admin (SaaS owner, no access to college data), Super Admin, College Admin, Faculty, Student. Roles and `active` live in `users/{uid}`.
- **Files:** the browser talks to [worker/](worker/src/index.js). The Worker forwards the user's own Firebase token to Firestore, so the same rules decide who may open a file.
- **Business rules** (attendance %, pass/fail, keys) are plain functions in [src/lib/calc.js](src/lib/calc.js) with unit tests.

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

Sign in as that Platform Admin, create a college (it creates the college's first Super Admin), then add departments, courses, subjects, years, semesters, sections, faculty and students.

## Tests

```bash
npm test             # business rules + file Worker (no emulator needed)
npm run test:rules   # Security Rules, against the Firestore emulator (needs Java)
```

If `npm run test:rules` stops with "port taken", a Java emulator from an earlier run is still alive (seen on Windows). End that Java process, or change the port in `firebase.rules-test.json` (now 8888).

The rules tests cover tenant isolation, role limits, audit-entry reuse, attendance and marks ownership, timetable locks, enrollment-number uniqueness, file slots and status, and result privacy.

## Deploy

1. **Firebase (Spark):** create a project, enable Email/Password sign-in, create Firestore in production mode. Put the project ID in `.firebaserc` and the web config in `.env`. Then `npx firebase deploy --only firestore,hosting` after `npm run build`.
2. **First Platform Admin:** run `scripts/create-platform-admin.js` with a service-account key stored outside this repo.
3. **App Check:** register the web app with reCAPTCHA v3 in the Firebase console and put the site key in `VITE_APPCHECK_SITE_KEY`. Watch it in monitor mode first. The app and the file Worker both pass the App Check token on, so enforcing it later does not break file access. For local work, leave the site key empty in `.env` (reCAPTCHA only issues tokens for registered domains), or set a debug token in the browser as the Firebase App Check docs describe.
4. **Files (Cloudflare):** create a private R2 bucket, set `FIREBASE_PROJECT_ID` and `ALLOWED_ORIGIN` in [worker/wrangler.toml](worker/wrangler.toml), run `npx wrangler deploy` in `worker/`, and put the Worker URL in `VITE_FILES_URL`. Without it, everything except file upload works.
5. **Backups:** none, by decision. Spark has no managed backups.

## Limits you should know

- Spark's free daily quotas are shared by every college (20k writes a day for the whole project). Treat Spark as a one-college pilot; a real multi-college launch needs Blaze. Spread bulk marks entry and result publishing over several days.
- Without server code, a hostile staff member can burn the shared write quota, and rules cannot check that a student belongs to the section they are marked in. See the `shortcut:` notes in [system_design.md](system_design.md) for each limit and its upgrade path.
- One email address belongs to one college.
