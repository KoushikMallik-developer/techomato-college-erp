# College Management System — Product Requirements (MVP)

**Version:** 1.2  
**Status:** Proposed MVP  
**Last updated:** 2026-10-31  
**Frontend/backend platform:** React.js + Firebase (Spark free plan for the pilot; Blaze before onboarding several paying colleges)

## 1. Product overview

A responsive web-based College Management System (CMS) that centralizes student, faculty, academic, attendance, and examination workflows. It is a multi-tenant software-as-a-service (SaaS) product: many colleges (tenants) share one deployment, and each college sees only its own data. The product should remain modular so it can be extended with additional modules later.

### Goals
- Replace fragmented spreadsheets and paper registers with structured records.
- Give administrators a reliable operational overview.
- Let faculty record attendance and marks without accessing unrelated data.
- Let students view their own academic information.
- Keep every college's data completely separate from every other college's.
- Keep the first release simple, secure, and free to run on the Firebase Spark plan.

### Out of scope for MVP
Fees, payments and receipts (no payment system), online admission applications, library, hostel, transport, payroll, placement, inventory, AI, mobile apps, online exams, parent portal, automated timetable generation, SaaS subscription billing, self-service college sign-up (the Platform Admin creates and suspends colleges by hand), and custom domains or branding.

## 2. User roles

| Role | Core permissions |
|---|---|
| Platform Admin | The SaaS owner. Creates, suspends, and reactivates colleges and manages each college's first Super Admin. Cannot read any college's students, attendance, or marks |
| Super Admin | Manage the college's configuration, user accounts, roles, and all of the college's records |
| College Admin | Manage students, faculty, academics, timetables, attendance oversight, exams, announcements, and reports |
| Faculty | View assigned subjects/classes, record attendance and marks for assigned classes |
| Student | View own profile, timetable, attendance, and published results |

Access is deny-by-default and scoped to the user's assigned records. Every college is a separate tenant: a user belongs to exactly one college and cannot read or write another college's data. One email address belongs to one college. A suspended college is locked out on the next request. Roles and account status are stored in the user's profile document and enforced by Firestore Security Rules on every request, not only by frontend route guards. Deactivating a user takes effect immediately.

## 3. MVP modules and requirements

### 3.1 Dashboard
- **DASH-01:** Show total active students, active faculty, departments, and courses.
- **DASH-02:** Show today's student attendance summary.
- **DASH-03:** Show recent announcements; admin can create, edit, and archive announcements.
- **DASH-04:** Restrict widgets and data according to the signed-in user's role and scope.

### 3.2 Student management
- **STU-01:** Create, view, update, and deactivate student profiles.
- **STU-02:** Store unique enrollment number, contact details, admission date, department, course, and status. Batch, semester, and section come from the student's enrollment record for each academic period.
- **STU-03:** Upload and access student documents (PDF, JPEG, PNG, up to 1 MB, at most 20 files per student). Files are stored privately in Cloudflare R2; only admins of the college upload them, and only those admins and the student can open them.
- **STU-04:** Search, filter, and paginate student records.
- **STU-05:** Preserve historical academic records after deactivation.

### 3.3 Faculty management
- **FAC-01:** Create, view, update, and deactivate faculty profiles.
- **FAC-02:** Assign department, subjects, and class/section responsibilities.
- **FAC-03:** Record and review faculty attendance.
- **FAC-04:** Prevent unassigned faculty from changing another class's records.
- **FAC-05:** Faculty can upload their own documents (for example a CV or certificates; PDF, JPEG, PNG, up to 1 MB, at most 20 files). Only that faculty member and the college's admins can open them.

### 3.4 Academic management
- **ACA-01:** Manage departments, courses/programs, subjects, academic years, semesters, sections, and batches.
- **ACA-02:** Assign subjects to courses/semesters and faculty to class/subject offerings.
- **ACA-03:** Enroll students into an academic-year/semester section.
- **ACA-04:** Create and view a basic weekly timetable with classroom, period, subject, and faculty.
- **ACA-05:** Reject duplicate/conflicting room, faculty, or section timetable slots (room names compared ignoring letter case), including when two admins save at the same time.

### 3.5 Attendance management
- **ATT-01:** Faculty can record student attendance for assigned class sessions using Present, Absent, or Leave.
- **ATT-02:** Record faculty daily attendance using the same statuses.
- **ATT-03:** Allow authorized edits. Every edit to an existing record keeps a log of who changed it, the old value, and the new value.
- **ATT-04:** Calculate attendance percentage as present sessions / (present + absent sessions) × 100. Sessions marked Leave are excluded. There is no leave approval step in the MVP.
- **ATT-05:** Filter attendance by date, subject, class, and student; export basic reports.

### 3.6 Examination and results
- **EXM-01:** Create exams with type, course, semester, academic year, and date range.
- **EXM-02:** Configure subject-wise maximum and passing marks.
- **EXM-03:** Assigned faculty enter marks for their students; validation prevents out-of-range marks.
- **EXM-04:** Compute total, percentage, and pass/fail according to configured rules.
- **EXM-05:** Admin reviews and publishes results as a single step, and publishing is blocked while any student's marks are missing (a student who did not sit a paper is marked absent); students see only their own results, and only after publication.
- **EXM-06:** Export basic student result reports (CSV, or print to PDF from the browser).

### 3.7 Class materials
- **MAT-01:** Faculty upload class materials (PDF, JPEG, PNG, up to 2 MB each) to a class they currently teach (at most 100 files per class), and can remove their own uploads.
- **MAT-02:** Students enrolled in that class (same section and semester, not withdrawn) and the college's admins can open the materials; no one else can. Students cannot upload or delete.
- **MAT-03:** A replaced teacher can no longer upload to that class; materials already uploaded stay available to the class.

## 4. Key user journeys

1. **College setup:** Platform Admin creates the college and its first Super Admin → Super Admin completes institution settings → academic year → departments → courses → subjects → semesters/sections → faculty assignments.
2. **Student onboarding:** College Admin creates student → assigns course/batch/semester/section → optionally uploads documents → creates the student's login and sends a password-reset email.
3. **Daily attendance:** Faculty opens assigned class → selects session/date → marks attendance → saves → student views attendance percentage.
4. **Results:** Admin creates exam → faculty enters marks → admin verifies/publishes → student views published result.
5. **Class materials:** Faculty uploads a file to a class they teach → students enrolled in that class open it.

## 5. MVP screens

- Login, password reset, profile, role-aware dashboard
- Students: list, create/edit, details, documents
- Faculty: list, create/edit, details, subject assignments
- Academics: departments, courses, subjects, academic years, semesters, batches/sections, timetable
- Attendance: class register, faculty register, reports
- Exams: exam list/setup, marks entry, publish results, student result view
- Class materials: faculty upload per class, student list per enrolled class; faculty profile documents
- Announcements and basic user administration
- Platform (Platform Admin only): college list, create college, suspend/reactivate

## 6. Nonfunctional requirements

- **Security:** Firebase Authentication; strict tenant isolation (each college's data lives under its own path and rules check the user's college on every request); roles and active status in the user profile, checked by least-privilege Firestore Security Rules on every request (student files are served by a Cloudflare Worker that defers to those rules); App Check enabled; no Admin credentials in the browser; audit log that cannot be edited or deleted.
- **Privacy:** Minimize personal data; use private document storage; define retention and deletion procedures; do not collect Aadhaar unless a clear lawful need is established.
- **Reliability:** Store attendance as one document per student per subject assignment so the free 1 GiB storage and daily read quota last. Use batched writes and transactions for related changes; use deterministic document IDs to prevent duplicates; the project keeps no backups of its own (the Spark plan has none managed).
- **Performance:** Paginate large lists; use indexed queries; avoid unbounded collection reads; use count queries for totals.
- **Cost and quota control:** The Spark plan stops service for all colleges when the shared daily free quotas are used up, so it fits a pilot of one or two colleges only; move to the Blaze plan before onboarding more. Estimate reads and writes per screen, avoid real-time listeners on large collections, spread bulk marks entry and result publishing over several days, and plan an upgrade to the Blaze plan before nearing the limits.
- **Accessibility:** Responsive UI, keyboard support, semantic labels, and reasonable contrast.
- **Observability:** Firebase console usage metrics and error monitoring for the web app.
- **Exports:** CSV for key lists and reports; PDF through the browser's print function.

## 7. Acceptance criteria

- Each role sees only authorized pages and data; cross-student and cross-faculty access is denied by Security Rules.
- A deactivated user is denied on their next request, even with a valid session.
- A user of college A cannot read or write any data of college B, including by guessing document IDs or sending another college's ID in a request.
- A suspended college is denied on the next request. The Platform Admin cannot read a college's students, marks, or attendance, and cannot create a Super Admin for an existing college.
- A student can open only their own files. A user of another college, a missing or forged login token, or a suspended college is refused by the file service.
- Class materials can be opened only by admins, the teacher, and students enrolled in that class. A replaced teacher cannot upload, and students cannot upload or delete. A faculty member's own documents are visible only to them and admins. Uploads over the size limit, without a declared size, or past the per-folder file cap are refused.
- Two colleges can use the same enrollment number, room name, and timetable slot without conflict.
- An admin can configure a department, course, semester, section, faculty assignment, and student enrollment end-to-end.
- Faculty can save and correct attendance for assigned sessions; every correction is logged with the old and new value; a second session or duplicate record for the same slot cannot be created.
- Student attendance percentage matches the documented calculation.
- Two timetable slots that clash on room, faculty, or section cannot both be saved, including concurrent saves and room names that differ only in letter case.
- When a teacher is replaced, the old teacher can no longer edit that class's attendance and the new teacher can mark it.
- Deactivating a student or faculty member also blocks their login.
- Duplicate enrollment numbers within a college are rejected, including ones that differ only in letter case, and an enrollment number cannot be changed to another student's.
- Faculty cannot save attendance or marks for a section, subject, or semester other than their assignment; marks cannot change after results are published.
- College Admin cannot create, change, or demote a Super Admin or another College Admin; audit entries cannot be reused to cover several edits.
- Marks outside allowed ranges are rejected; unpublished results are invisible to students; a failed publish shows nothing to students.
- Dashboard metrics reconcile with underlying records.
- Firestore Security Rules are tested in the Firebase Emulator Suite before release, including batch sizes that stay within rule lookup limits. The file Worker is tested for missing, forged and wrong-college tokens.

## 8. Release plan

| Milestone | Deliverable |
|---|---|
| M1 | React/Vite setup, Firebase project, Authentication, tenant model and Platform Admin, user profiles and roles, Security Rules with tenant isolation tests, academic structure |
| M2 | Student/faculty profiles, enrollments and assignments, student and faculty file upload (R2 Worker) |
| M3 | Timetable, attendance and class materials |
| M4 | Exams, marks, result publication, dashboards/reports |
| M5 | Security-rule tests, end-to-end tests, an offboarding procedure, quota review, pilot deployment with one college |

## 9. Product decisions to confirm

- Which Firebase plan runs the paid multi-college launch? Spark's shared quotas fit a pilot only; Blaze is expected.
- Semester-based only, or also annual programs?
- Are grade/SGPA calculations needed in MVP, or percentage and pass/fail only?
- Cloudflare R2: does enabling it need a payment method, and what are the current free limits? If you cannot add one, STU-03 (student files) moves out of the MVP.

**Default assumptions:** colleges share one Firebase project and are created by the Platform Admin by hand; one email address belongs to one college; the pilot runs one college; semester-based programs; percentage/pass-fail results; leave sessions excluded from attendance percentage; no parent accounts; Firebase Spark plan.
