# College ERP Product Requirements Document

## MERN rebuild for academic administration and campus self service

Version 1.0 | 2 November 2026 | Proposed baseline for product, design, engineering and QA

### Product recommendation

Build a single institution academic operations platform using MongoDB, Express, React and Node.js. Preserve the repository's core workflows for administrators, teaching staff and students, while introducing explicit authorization, academic history, reliable record updates and auditable decisions. Release the academic core first; complete library circulation as a separate release gate.

The product should let an administrator establish an academic session, enroll students, assign teaching responsibilities, monitor attendance and process requests. Staff should record attendance and assessment results for assigned classes. Students should access their own records, submit requests and read institutional communications.

This PRD defines the intended product, not a literal port of each Django screen. Requirements marked **Preserve** retain an evidenced capability; **Correct** repair a gap in that capability; **New** introduce a proposed capability. All target requirements are subject to institutional policy signoff. P0 means required for the academic pilot; P1 means required for the subsequent complete release; P2 means explicitly deferred.

### Decisions requested from the team

- Approve the P0 academic scope and the P1 library completion scope.
- Confirm the institution's academic calendar, enrollment structure, attendance policy and assessment rules before implementation.
- Assign an academic owner, product owner, technical lead, QA owner and migration owner.
- Approve a pilot with one course and one academic session before institution-wide adoption.

### Reading guide

Sections 1–4 explain scope, findings, roles and journeys. Sections 5–17 specify every functional area discovered in the application, plus the controls required to operate it. Sections 18–23 provide MERN design guidance, API boundaries, migration, quality gates, delivery sequencing and unresolved decisions. Section 24 maps requirements to source evidence.

---

## 1 Product scope and success measures

### Problem and intended outcomes

Academic records and administrative requests need a consistent source of truth. The existing application demonstrates useful workflows but does not adequately protect historical records or enforce every business boundary. The rebuild must make it clear who may change a record, which academic period it belongs to, when it becomes visible and how corrections are recorded.

The initial product is a responsive web application for one institution. One administrator/HOD role manages the institution; it does not imply a separate department-level permission hierarchy. A course means an academic program or cohort grouping, matching the repository's usage. An academic session means a start/end date interval, not a class meeting. A subject offering is the proposed association of subject, course, session and assigned teacher.

### Release boundaries

| Release | Included | Explicit boundary |
| --- | --- | --- |
| P0 academic pilot | Authentication, dashboards, courses, sessions, staff, students, subject offerings, attendance, results, leave, feedback, in-app notifications, profiles, audit and migration controls | Required before real academic records are accepted |
| P1 complete release | Library catalog and circulation, web push, bulk onboarding, operational exports and reporting | Library cannot be called complete until issue and return work together |
| P2 discovery backlog | Fees, timetable generation, online examinations, parent portal, SMS and advanced analytics | Separate discovery and PRDs; not assumed existing functionality |

Admissions applications, payroll, hostel, transport, procurement, placement, alumni, LMS content and multi-institution SaaS are outside this PRD. These were not found as implemented application modules. They may be added through separately approved scope.

### Proposed pilot targets

These are acceptance targets, not measured baselines. The product owner should baseline the current process in pilot discovery.

- At least 95% of conducted pilot classes have submitted attendance by the next working day, measured against an independently maintained class log because timetable generation is deferred.
- A trained teacher completes attendance for 60 students in three minutes or less in a moderated usability test.
- Every published result is traceable to an author, offering, assessment policy and publication event; no unresolved reconciliation differences remain at release.
- At least 90% of leave requests receive a decision within two working days, measured from submission to decision using the institution's working calendar.
- No successful unauthorized cross-student or cross-teacher access in the release test suite; no unresolved critical data-loss defects.
- At least 80% of active pilot students access their account within two weeks of invitation. Report invitation failures separately from adoption.

---

## 2 Codebase assessment and product implications

The reviewed application uses Django templates, Python views and a SQLite configuration, with deployment database overrides. It defines three user types and 19 domain models. The review examined application models, forms, URL routing, views, middleware, templates, configuration and the test stub. Static findings establish intended behavior; they do not establish successful execution in production. The included database's personal records were not needed for this scope review.

| Finding | Evidence | Rebuild implication |
| --- | --- | --- |
| Authentication middleware contains unresolved merge markers | main_app/middleware.py:10–32; middleware registered in settings | This checkout has a Python syntax blocker; do not use it as a validated runtime baseline |
| UI limits subjects, but several mutation handlers accept arbitrary IDs | staff_views.py:55–145, 257–303; EditResultView.py:24 onward | Enforce teacher assignment and student enrollment on every server operation |
| Results contain only student, subject, test and exam | models.py:194–201 | Add session/offering identity and controlled publication; preserve old results |
| Attendance lacks declared uniqueness and writes rows individually | models.py:130–143; staff_views.py:76–95 | Prevent duplicates, validate the entire roster and make submission atomic |
| Leave and absence are combined in one dashboard series | hod_views.py:62–69 | Keep approved leave separate from recorded absence and define denominators |
| Library issuance is incomplete | staff_views.py:327–357; referenced issue/list templates absent | Build inventory, return and correct loan history before operational use |
| Push sending embeds a server credential and does not inspect provider success | hod_views.py:632–682 | Replace configuration, rotate affected credentials and track delivery independently |
| Destructive handlers call delete directly | hod_views.py:685–725 | Archive referenced records and require explicit, authorized mutations |
| Multiple writes are CSRF-exempt; tests.py contains no implemented tests | views, staff/student/HOD handlers; tests.py | Add mutation protection, authorization tests and failure-path tests |

The library model includes a 14-day default loan duration and the view computes 5 currency units per overdue day. Currency, fine collection and institutional policy are unspecified. These values are legacy behavior, not approved financial policy.

The README lists email notifications as complete, but the inspected notification handlers use Firebase push; Django password reset routes and SMTP configuration exist. General transactional email delivery must therefore be implemented and verified if selected. Files named “erpnext” are presentation templates; their names do not establish an ERPNext integration.

---

## 3 Personas and permission model

### Roles

The administrator owns academic configuration, user records, approvals and institutional reporting. Teaching staff own attendance and draft results only for assigned offerings. Students access their own academic and request records. A proposed **Library Operator** permission may be granted to selected staff for P1; it is not a fourth legacy user type. Infrastructure operators are operational accounts, not unrestricted academic users.

| Capability | Administrator | Teaching staff | Student |
| --- | --- | --- | --- |
| Courses, sessions and assignments | Manage and archive | Read assigned context | Read own context |
| Staff and student administration | Manage | Minimal assigned rosters | Own profile only |
| Attendance | Read all; approve corrections | Submit/correct assigned offerings within policy | Read own records |
| Assessment results | Review, publish, reopen | Draft and submit assigned offerings | Read own published results |
| Leave | Decide staff/student requests | Submit and view own | Submit and view own |
| Feedback | Read and reply | Submit and view own | Submit and view own |
| Notifications | Send and inspect delivery | Read own | Read own |
| Library | Configure and delegate | Operate only with permission | Browse; view own loans |
| Audit and institutional exports | Authorized read/export | Assigned reports only | Own records only |

### Mandatory authorization rules

AUTHZ-01 **Correct, P0:** Deny access by default. Check authenticated user, active status, permission and resource scope on the server. React navigation is a convenience, not the security boundary.

AUTHZ-02 **Correct, P0:** Derive the requesting student or teacher from the session. Do not trust a submitted owner ID. An administrator choosing another user's record must have an explicit management permission.

AUTHZ-03 **New, P0:** Assignment changes take effect on new requests immediately. Preserve authorship on old records. Staff may not publish results or approve their own leave through a broader UI route.

AUTHZ-04 **New, P0:** Never return password hashes, reset tokens, push tokens or unnecessary address/profile data in rosters and reports. Log privileged exports and permission changes.

**Acceptance:** For two teachers with different offerings and two students in the same course, attempt every read and mutation using the other user's IDs. All forbidden requests fail without returning protected data or changing records. A deactivated user loses access even with an existing browser session. An ordinary staff member cannot issue a book until the library permission is granted.

---

## 4 End to end journeys and shared experience

### Institution setup and enrollment

Administrator creates a course and session, registers staff, creates subjects and session-specific offerings, assigns teachers, then enrolls students. The system checks all dependencies before making an offering available for attendance or results. Missing setup produces an actionable message identifying the missing item. A student's change of course/session creates a dated enrollment change; it does not rewrite historical attendance or results.

### Daily teaching and student visibility

Staff selects an assigned offering and class date, loads the eligible roster, records every student's status and submits once. The system confirms a committed submission. Students and administrators see the same record and totals. A retry after a network interruption must not create another class. Later corrections require a reason and leave an audit event.

### Assessment publication

Staff selects an offering, enters test and exam scores, reviews validation errors and submits for publication. Administrator reviews completeness and publishes a version. Students see only published scores. Reopening records preserves the last published version until the corrected version is explicitly published.

### Requests and communication

Student or staff submits leave/feedback and receives a tracking ID. Administrator sees the pending queue and decides or replies. The requester sees status history and an in-app notification. A failed email or push delivery never reverses the underlying leave decision or feedback reply.

### Shared interface requirements

UX-01 **New, P0:** Use role-specific navigation with an explicit current session context. Every list supports loading, empty, error and permission-denied states. Tables expose search, filters and pagination where records can grow.

UX-02 **New, P0:** Preserve entered form data after validation/network errors. Show field-level errors and a summary; prevent duplicate submission while a request is pending. Explain whether a save succeeded when reconnecting.

UX-03 **New, P0:** Support keyboard operation, visible focus, labelled inputs and status text beyond color. Use mobile-friendly rosters and readable tables from 360px wide screens through desktop. Confirm destructive or irreversible actions with the affected record name.

UX-04 **New, P0:** Use the configured institution timezone for academic dates and display UTC timestamps in local time. Display “No records” when a denominator is zero. Distinguish an unavailable service from an empty dataset.

**Acceptance:** Complete setup, attendance, result publication and leave approval using real role boundaries in staging. A student sees the newly committed data without assistance from an administrator, and refresh/retry does not duplicate any operation.

---

## 5 Identity and account access

**Intent:** Let approved users access the correct portal and recover access without exposing account information. **Evidence:** views.py login/logout; EmailBackend.py; CustomUser; Django auth URLs and password reset templates.

### Requirements

IAM-01 **Preserve, P0:** Support email/password login, logout and role-specific landing pages. Normalize email consistently and enforce uniqueness. Account creation is administrator-controlled; public self-registration is excluded.

IAM-02 **Correct, P0:** Reject inactive accounts and invalid credentials with a generic message. Rate-limit repeated login and reset attempts. Use adaptive password hashing; never store or log plaintext passwords. CAPTCHA is optional abuse protection, with explicit failure handling when enabled.

IAM-03 **Preserve and correct, P0:** Offer a remember-me option. Proposed defaults are browser-session authentication without remember-me and a revocable maximum of 30 days with it, reflecting legacy intent. Final idle and privileged-session limits require the security owner's approval.

IAM-04 **Preserve and correct, P0:** Password reset uses an expiring, single-use token and a generic acknowledgement whether or not an email exists. Proposed token lifetime is 30 minutes. Successful reset invalidates existing sessions. Use a configured mail service and verify delivery in staging.

IAM-05 **New, P0:** New users activate through a single-use invitation and choose their password. Administrators may resend invitations or trigger reset but cannot retrieve passwords. Invitation expiry defaults to 48 hours and is configurable.

IAM-06 **New, P0:** Keep sessions in Secure, HttpOnly cookies with a deliberate SameSite policy and CSRF protection for cookie-authenticated mutations. Rotate session identifiers on authentication. Logout invalidates the server session.

### Screens and data

Login, forgot password, reset password, activate account and session-expired screens. Store user ID, normalized email, role, active status, password hash, activation status and security timestamps. Store hashed reset/invitation tokens and expiry separately from the profile. Account states are invited → active → suspended/archived; failed delivery does not activate an account.

### Acceptance criteria

- IAM-A1: A valid active staff login lands on the staff dashboard; a student cannot access administrative APIs by changing the URL.
- IAM-A2: Resetting once succeeds; reusing or using an expired token fails. No raw token appears in application logs.
- IAM-A3: Logout or suspension makes the existing cookie unusable. A remembered session remains revocable.
- IAM-A4: Unregistered and registered emails receive the same public reset response; provider failure is visible only to authorized operators.

---

## 6 Dashboards and operational reporting

**Intent:** Give each role a trustworthy summary with a path to the underlying records. **Evidence:** admin_home, staff_home and student_home; role dashboard templates. The source has counts and charts, not a general BI system.

### Requirements

DASH-01 **Preserve and correct, P0:** Administrator dashboard shows active students, staff, courses and subjects; pending leave and unanswered feedback; attendance summaries by course and offering. Every card defines its period and filters. Historic and current totals must not silently mix.

DASH-02 **Preserve, P0:** Staff dashboard shows assigned offerings, eligible student counts, submitted class registers and own request statuses. “Attendance taken” means submitted class registers, not student attendance percentage.

DASH-03 **Preserve and correct, P0:** Student dashboard shows own enrolled subjects, attendance and published result availability, plus pending requests and unread messages. An empty history displays “No attendance recorded,” not 0% attendance.

DASH-04 **Correct, P0:** Attendance percentage = present records / (present + absent records) × 100 for submitted, non-voided eligible classes in the selected period. Display one decimal place; compute from full precision. Unmarked drafts, canceled classes and classes outside enrollment dates are excluded. Approved leave is a separate indicator and does not alter this formula by default.

DASH-05 **New, P1:** Provide CSV exports for student rosters, attendance details/summary, published results, leave queues and library loans. Export filters must match the screen. Include generation time and scope. Escape cells that could be interpreted as spreadsheet formulas.

DASH-06 **New, P0:** Record completion, validation failure and workflow-duration events without including feedback text, addresses or credentials. Restrict analytics to authorized aggregate views.

### Acceptance criteria

- DASH-A1: Eight present and two absent records display 80.0%; zero eligible records display “No records.” Adding an approved leave does not add a second absence.
- DASH-A2: A dashboard total reconciles exactly with its drill-down after applying identical filters. Voiding a class updates both.
- DASH-A3: A teacher's report excludes unassigned offerings; a student's response contains no other student's rows.
- DASH-A4: An export preserves selected filters and distinguishes class count from student attendance-record count.

**Dependencies:** Enrollment, offerings, attendance, results and requests. Advanced predictive analytics and timetable-based “missed class” detection remain deferred.

---

## 7 Course management

**Intent:** Establish the academic grouping used by staff, students and subjects. **Evidence:** Course model; course forms; HOD add/manage/edit/delete handlers.

### Requirements

CRS-01 **Preserve, P0:** Administrator creates, lists and edits courses. Preserve course name with the source limit of 120 characters. Add a stable course code, description and active/archive status; codes are unique within the institution and are not reused.

CRS-02 **Correct, P0:** Trim names and validate required fields on the server. Duplicate codes fail with a field-level error. Similar names produce a warning; the institution may intentionally have similarly named programs.

CRS-03 **New, P0:** Course details show linked subjects, current offerings, staff and enrollments. Course membership alone does not authorize a teacher to edit every subject in that course.

CRS-04 **Correct, P0:** Archive a referenced course instead of cascading deletion. Archived courses remain visible in historical records and are unavailable for new assignments. Block archival when active offerings or enrollments require a planned closure. Hard deletion is restricted to unused setup records and recorded in audit history.

### Workflow and interface

Course list → create/edit → dependency summary → activate or archive. Search by name/code; filter by status. Before archival, display affected active offerings and enrollments. The administrator must close or transfer them using their own effective dates.

**Data:** courseId, code, name, description, status, createdAt, updatedAt, archivedAt and actor IDs. The proposed course is not a full department, degree curriculum or credit framework. Semester structures require the decision in section 23.

### Acceptance criteria

- CRS-A1: Creating the same normalized course code twice produces one course and one validation error.
- CRS-A2: An archived course cannot be selected for a new offering; an old result still shows its original course.
- CRS-A3: Attempting to delete a course referenced by attendance, results or enrollment does not remove those records.
- CRS-A4: Editing the course's display name does not change its stable ID or alter the ownership of historical records.

**Dependencies:** Identity and audit. Courses must be configured before staff course affiliation, subjects and enrollments.

---

## 8 Academic sessions and enrollment periods

**Intent:** Define when academic activity belongs and preserve records across years. **Evidence:** Session model contains start/end dates; HOD session CRUD; student.session reference.

### Requirements

SES-01 **Preserve and correct, P0:** Administrator creates a session with name/code, start date and end date. End must not precede start. Use institution-local date values. Codes must be unique; overlapping sessions may exist for different cohorts, with a warning rather than an unconditional prohibition.

SES-02 **New, P0:** Session lifecycle is draft → active → closed → archived. Only active sessions accept ordinary academic writes. Closing requires resolution of draft attendance and unpublished results or explicit administrator acknowledgement of exceptions.

SES-03 **New, P0:** A user may select a session for reports without changing the institution's default active session. Multiple active sessions are permitted where cohorts overlap. Every academic API request has an explicit offering/session scope.

SES-04 **Correct, P0:** Enrollment is a dated record linking student, course and session. A transfer closes the old enrollment and creates a new one atomically. Do not update one foreign key and lose the prior relationship.

SES-05 **New, P0:** Changes to session dates must be blocked if they would exclude existing classes or enrollment intervals, unless an administrator completes an audited correction process. Reopening a closed session requires a reason and an authorized role.

### Screens and data

Session list, setup form, closure checklist and enrollment history. Fields include session code/name, start/end dates, state and closure metadata. Enrollment stores studentId, courseId, sessionId, effectiveStart, effectiveEnd, status and source reference. Proposed baseline permits one current course enrollment per student in a session; dual enrollment is a decision gate.

### Acceptance criteria

- SES-A1: A reversed date range is rejected without creating a session.
- SES-A2: Closing a session blocks new attendance and result edits but permits authorized historical reads.
- SES-A3: Moving a student to another course preserves old course attendance/results; subsequent rosters use the new effective enrollment.
- SES-A4: A closure or reopening records actor, timestamp, reason and previous/new state.

**Dependencies:** Courses and student identity. Promotion is enrollment creation for a later session, not automatic graduation or a full progression engine.

---

## 9 Staff administration

**Intent:** Maintain staff identities and teaching responsibility. **Evidence:** Staff and CustomUser models; StaffForm; HOD staff CRUD.

### Requirements

STF-01 **Preserve, P0:** Administrator creates and edits staff records with first name, last name, email, course affiliation, address, gender and profile image. Proposed changes: image and gender are optional; institutional policy determines collection necessity. Add a unique staff code and account status.

STF-02 **Correct, P0:** Create the account and staff profile as one atomic action. If any validation or persistence step fails, do not leave an orphan account or unused upload. Activation follows IAM-05.

STF-03 **New, P0:** Show assigned offerings separately from the staff member's home course. An administrator can assign another course's offering explicitly; course affiliation alone confers no write rights. Initial scope permits one responsible teacher per offering.

STF-04 **Correct, P0:** Deactivating staff immediately revokes access and requires reassignment or closure of current offerings. Retain prior attendance authorship, result revisions, leave and feedback. Ordinary deletion cannot erase academic history.

STF-05 **New, P1:** Bulk staff import provides a downloadable field template, dry-run validation, duplicate detection and a row-level report. Confirmed import is repeatable without duplicate accounts. Bulk onboarding is separate from migration of historic records.

### Screens and data

Staff directory with search by name, code or email; course/status filters; create/edit form; details with assignments and lifecycle events. Store staffId, userId, staffCode, homeCourseId and status. Restrict personal information to administrators and the account owner; teaching rosters do not need residential addresses.

### Acceptance criteria

- STF-A1: An invalid course or duplicate email fails the whole creation, leaving no partial profile.
- STF-A2: Deactivating a teacher preserves all authored records and prevents the teacher from saving again.
- STF-A3: A teacher affiliated with Course A can update Course B only after an explicit offering assignment.
- STF-A4: Retrying a confirmed import does not create duplicate staff accounts; errors identify the failed row without exposing other users' sensitive data.

**Dependencies:** Identity, courses, offerings and audit. Payroll, staff recruitment and attendance for employees are excluded; the existing attendance module is student class attendance.

---

## 10 Student administration and enrollment

**Intent:** Maintain each student's account and academic history. **Evidence:** Student and CustomUser models; StudentForm; HOD student CRUD.

### Requirements

STU-01 **Preserve, P0:** Administrator creates, searches and edits students with first/last name, email, course, session, address, gender and profile image. Add a required unique admission/student number; make image and gender optional pending policy. Phone, guardian and admissions-document collection are outside the baseline.

STU-02 **Correct, P0:** Validate active course/session and create identity, profile and initial enrollment atomically. Normalize email and retain a stable student ID independent of user ID, admission number and displayed row number.

STU-03 **New, P0:** Support active, completed, withdrawn and suspended academic statuses, distinct from account access status. Record effective date and reason. Changing current status must not change eligibility on historical dates.

STU-04 **Correct, P0:** Transfer or progression appends enrollment history. Already submitted attendance retains its roster snapshot. If a backdated enrollment correction affects existing registers, create an exception for review rather than silently changing denominators.

STU-05 **New, P1:** Bulk import offers preview, required-field validation, duplicate checking and row-level results. Require explicit confirmation before invitations are sent. Invalid rows cannot create partially configured students.

### Screens and data

Student directory, creation/edit form, enrollment timeline and academic detail view. Administrator can filter by course, session and status. Staff sees only the minimum roster fields for assigned offerings. Students can view their own academic identifiers but cannot edit admission number, role, course or enrollment.

**Data:** studentId, userId, admissionNumber, academicStatus and effective-dated enrollments. Do not embed unbounded results or attendance history in the student document.

### Acceptance criteria

- STU-A1: Duplicate admission number/email is rejected; concurrent creates cannot bypass uniqueness.
- STU-A2: A transfer on 15 July changes eligibility from that date while preserving records from 14 July.
- STU-A3: A suspended account cannot log in, but authorized staff can still read its historical records.
- STU-A4: A student cannot change their enrollment or view another student's personal details through API manipulation.

**Dependencies:** Identity, courses and sessions. Admission applications and fee clearance are separate future modules.

---

## 11 Subjects and teaching assignments

**Intent:** Connect the curriculum to a session, a roster and an accountable teacher. **Evidence:** Subject model links name, course and staff; HOD subject CRUD; staff subject filters.

### Requirements

SUB-01 **Preserve, P0:** Administrator maintains subjects with name, stable code, course and active/archive status. Subject codes are unique within a course. Preserve the source name limit of 120 characters.

SUB-02 **Correct, P0:** Separate the reusable subject definition from a session-specific **subject offering**. An offering links subjectId, courseId, sessionId and responsibleStaffId. Attendance and results reference the offering so that changing next year's teacher cannot rewrite last year's context.

SUB-03 **New, P0:** Eligible roster consists of students enrolled in the offering's course and session on the class/assessment date. Baseline assumes all course subjects are compulsory. Electives, sections, semesters and multiple teachers require approved model changes before coding.

SUB-04 **Correct, P0:** Validate that subject.course matches offering.course and that assigned staff is active. Cross-course teaching requires an explicit assignment. Record assignment effective dates and preserve prior teachers in history.

SUB-05 **New, P0:** Offerings move from draft to active to closed. Closed offerings are read-only except for an audited reopening. An offering with attendance or results cannot be hard-deleted. Duplicate subject/course/session offerings are blocked under the baseline one-cohort model.

### Screens and data

Subject directory and edit form; session offering list; assignment editor; read-only roster preview. Show course, session, teacher and status in attendance/result selectors to avoid ambiguous duplicate names.

**Data:** subject definition, offering, assignment history, assessment policy reference and current state. A staff member's current affiliation must not replace the offering's explicit authorization.

### Acceptance criteria

- SUB-A1: Reassigning a teacher removes the former teacher's new-write permission and grants the new teacher access without changing prior authorship.
- SUB-A2: A subject in Course A cannot be attached to a Course B offering accidentally.
- SUB-A3: Two sessions may offer the same subject independently, with separate attendance and results.
- SUB-A4: A withdrawn student is excluded from future roster generation but remains in already submitted registers.

**Dependencies:** Courses, sessions, staff and enrollment. This module is a prerequisite for attendance and assessment implementation.

---

## 12 Student attendance

**Intent:** Create one trustworthy class register and consistent student visibility. **Evidence:** Attendance/AttendanceReport; staff take/update handlers; student and administrator attendance views; common get_attendance endpoint.

### Requirements and rules

ATT-01 **Preserve, P0:** Assigned staff selects offering, date and class slot, loads eligible students and marks Present or Absent. New drafts start Unmarked; require all eligible rows to be resolved before submission. Bulk “mark all present” requires an explicit action.

ATT-02 **Correct, P0:** Use a unique offering/date/slot key. Proposed default slot is “1” for legacy one-register-per-day use; additional daily classes require distinct slots. Store the submitted roster snapshot and enrollment references.

ATT-03 **Correct, P0:** Validate assignment, session state, class date and each student's eligibility on the server. Reject future class dates and dates outside the session. An invalid row rejects the entire submission. A retry with the same idempotency key returns the original outcome.

ATT-04 **New, P0:** Draft → submitted → corrected or voided. Proposed correction window is 48 hours after submission; later corrections require administrator reopening. Every correction or void requires a reason, author and before/after history. Voiding preserves evidence and removes the register from aggregates.

ATT-05 **Preserve and correct, P0:** Students see only their own status by subject and inclusive date range. Administrators see registers across the institution. Teachers see assigned offerings. Validate start ≤ end and use the same calculation as DASH-04.

ATT-06 **New, P0:** Detect conflicting edits with a version number. A stale update returns a conflict and prompts a reload; it cannot overwrite a newer correction. Approved leave is displayed beside a date where applicable but does not automatically mark Present or change attendance.

### Acceptance criteria

- ATT-A1: Submitting a 60-student register creates one committed register and 60 records; failure on row 60 creates none of the submitted records.
- ATT-A2: Double click, retry and concurrent submission for the same offering/date/slot cannot create duplicate attendance.
- ATT-A3: Injecting an unenrolled student or another teacher's offering fails without partial changes.
- ATT-A4: An approved correction changes the student's report and aggregate once, with old value and reason retained.
- ATT-A5: A voided class is excluded from the denominator; a student's absence on an approved leave date is counted only once.

**Screens:** Take attendance, review/submit, register history, correction dialog and personal attendance report. Offline submission, biometrics and QR attendance are deferred.

---

## 13 Assessments and result publication

**Intent:** Publish accurate, period-specific scores while retaining corrections. **Evidence:** StudentResult; staff_add_result/fetch; EditResultView; student_view_result. The entry template limits test to 40 and exam to 60; the server model has unrestricted float fields.

### Requirements and rules

RES-01 **Preserve and correct, P0:** Assigned staff enters test and exam scores for eligible students in an offering. Proposed default is 40 + 60 = 100, reflecting the source UI. Store score limits in a versioned assessment policy, validate on the server and support at most two decimal places. Reject negative, non-finite and above-limit values.

RES-02 **Correct, P0:** Result identity is student + offering + assessment cycle. P0 has one final cycle per offering. A later session creates a new result; it never overwrites the prior year. Retests and supplementary cycles are deferred until rules are agreed.

RES-03 **New, P0:** Draft → submitted → published. Staff saves drafts and submits; administrators publish complete batches after review. A legitimate zero is different from Not entered or Absent. Absence requires an explicit state and policy treatment, not an automatic zero.

RES-04 **New, P0:** Published versions are immutable. Corrections require administrator reopening, reason, new draft revision and republishing. Keep the previous published version visible until replacement publication. Notify affected students after commit.

RES-05 **Preserve, P0:** Students see subject, academic session, test, exam, total, publication date and revision indicator for their own published results. Compute totals numerically, never through presentation-layer string operations.

RES-06 **New, P0:** Freeze the assessment-policy version once results use it. Do not invent pass/fail, grades, GPA or credits from the existing two scores. Those outcomes need an approved grading policy and are outside baseline acceptance.

### Acceptance criteria

- RES-A1: Test 35.5 and exam 52.25 display total 87.75; test 40.01 fails under the default policy, including direct API submission.
- RES-A2: Draft results are invisible to students. Publication makes the reviewed batch visible atomically.
- RES-A3: The same subject in a later session retains separate scores; concurrent edits detect stale versions.
- RES-A4: Reopening does not erase the old published result. Republishing retains both revision events and notifies each affected student once.
- RES-A5: An injected student ID outside the offering is rejected. A missing component cannot silently become zero.

**Dependencies:** Offerings, enrollment, identity, notifications and audit. Online test delivery, question banks and proctoring are excluded.

---

## 14 Student and staff leave

**Intent:** Let users request absence and administrators make traceable decisions. **Evidence:** separate student/staff leave models and forms; applicant history; HOD approval handlers. Legacy status values are 0 pending, 1 approved and -1 rejected.

### Requirements

LEV-01 **Preserve and extend, P0:** Students and staff submit a reason and date range, with a single day represented by equal start/end dates. Show a preview before submission. Start must not exceed end; proposed reason length is 10–2,000 characters. Attachments, paid leave balances and payroll integration are excluded.

LEV-02 **Preserve and correct, P0:** Administrator queue separates staff and student requests, with requester, course/session context where applicable, dates, submission time and status filters. Approve or reject; rejection requires a reason.

LEV-03 **New, P0:** State machine is pending → approved/rejected/cancelled. Applicants may cancel pending requests. Approved requests cannot be silently overwritten; an administrator may revoke with a reason, creating a new decision event. Applicants cannot approve their own requests.

LEV-04 **New, P0:** Block overlapping pending/approved requests for the same applicant. Past-date requests are allowed with a warning and explicit explanation to support genuine retrospective requests. Academic dates outside a student's enrollment period require administrator review.

LEV-05 **Correct, P0:** Leave approval does not edit attendance, create additional absent records or deduct any balance. Show approved leave as contextual information. Any later excused-absence policy must be explicitly approved and versioned.

LEV-06 **New, P0:** Commit decision and in-app notification together through a durable event. Conflicting decisions on the same version return a conflict instead of silently replacing the first decision.

### Data and screens

Unified leaveRequests collection with applicantUserId, applicantRole, startDate, endDate, reason, status, submittedAt and decision history. Screens include apply, own history/detail, administrator queue and decision dialog. Only the applicant and authorized administrator see the reason text.

### Acceptance criteria

- LEV-A1: A valid request appears once in the applicant history and admin queue with Pending status.
- LEV-A2: Rejecting without a reason fails. Approving records approver/time and sends one in-app notification.
- LEV-A3: Two simultaneous opposite decisions cannot both succeed against the same version.
- LEV-A4: Overlapping approved/pending leave is blocked, and approval leaves attendance totals unchanged.

---

## 15 Feedback and administrative replies

**Intent:** Provide a private channel for students and staff to raise issues and read a response. **Evidence:** FeedbackStudent/FeedbackStaff; applicant forms/history; HOD feedback reply handlers. The legacy model stores one feedback text and one reply, not a conversation thread.

### Requirements

FDB-01 **Preserve, P0:** An authenticated student or staff member submits feedback and views their own history. Proposed length is 10–5,000 characters. Preserve line breaks safely and render text without executing markup.

FDB-02 **Preserve and correct, P0:** Administrator views separate or role-filtered queues, reads each message and posts a reply. A reply must be non-empty and at most 5,000 characters. P0 retains a single administrative reply; a full helpdesk conversation is deferred.

FDB-03 **New, P0:** Status is open until replied, then answered. Store reply author/time. If an administrator corrects a reply, retain the prior version and reason. Notify the requester after the response is committed.

FDB-04 **Correct, P0:** Feedback is private to its author and authorized administrators. Teachers cannot browse student feedback merely because they teach those students. Do not claim anonymity; the administrator sees the sender's identity.

FDB-05 **New, P1:** Add category and optional assignment to a designated administrator if institutional volume justifies it. Escalation rules, anonymous complaints and disciplinary case management require separate policy and are deferred.

### Workflow and data

Compose → validate → submit → open queue → administrator reply → answered history. A user receives a tracking ID and can open the detail page after a failed notification. Store feedbackId, authorUserId, authorRole, message, state, reply text/version, responderId and timestamps.

### Acceptance criteria

- FDB-A1: A staff member sees only their own feedback; swapping a feedback ID cannot expose another person's message or reply.
- FDB-A2: An administrator response changes the queue status to Answered, displays in the author's account and creates one notification.
- FDB-A3: Script/HTML payloads render as harmless text, and oversized/empty submissions receive field errors.
- FDB-A4: A corrected reply retains a readable revision history for the administrator and a correction indicator for the author.

**Dependencies:** Identity, notifications and audit. Do not include feedback message bodies in general analytics, push previews or operational error logs.

---

## 16 Notifications and user profiles

### Institutional notifications

**Evidence:** NotificationStaff/NotificationStudent, per-user FCM token, administrator send handlers and recipient inboxes.

NOT-01 **Preserve and correct, P0:** Administrator composes a message for an individual staff member or student. Save the in-app notification durably before attempting external delivery. Add read/unread state and newest-first history; recipients can mark only their own items read.

NOT-02 **New, P0:** Generate in-app notices for leave decisions, feedback replies and result publication. Proposed limits are title 120 characters and body 2,000 characters. System notifications link to authorized detail screens; access checks remain mandatory after following a link.

NOT-03 **New, P1:** Support audience selection by role/course/session with recipient-count preview and explicit send confirmation. Freeze the recipient list at dispatch and deduplicate each recipient for the event.

NOT-04 **Correct, P1:** Web push is opt-in, supports multiple devices and tracks queued/sent/failed outcomes separately from read state. Use current Firebase HTTP v1 server authentication, not the source's embedded server-key approach. Invalid tokens are retired and transient errors retried with limits. Provider acceptance does not prove a user read a notification. See technical references in section 24.

**Acceptance:** A push outage leaves the in-app message intact; retry creates no duplicate inbox item. An expired device token does not fail other recipients. Private result scores and feedback text do not appear in lock-screen push previews.

### Profile and account self service

**Evidence:** profile views/forms for all three roles. Legacy forms expose email but self-service handlers do not consistently persist it.

PRO-01 **Preserve and correct, P0:** Users view their profile and update permitted names, address and optional profile image/gender. Academic identifiers, role, course and session are read-only. Email change requires administrator action plus verification; do not display an editable field that is ignored.

PRO-02 **Correct, P0:** Password change requires current password and invalidates other sessions. An empty password field leaves the password unchanged. Forgotten passwords use the reset workflow.

PRO-03 **New, P0:** Accept JPEG/PNG images up to a proposed 2 MB; validate actual content and dimensions, use generated storage keys and serve through controlled media access. Replace images safely and clean up failed uploads. Use a default avatar if none is supplied.

**Acceptance:** Updating an address persists after re-login; attempting to set another role/course is rejected. A fake image or oversized upload fails without changing the existing picture. Password change with an incorrect current password fails.

---

## 17 Library catalog and circulation

**Intent:** Complete the partially implemented library workflow. **Evidence:** Book, Library and IssuedBook models; add_book, issue_book, view_issued_book and student view_books. Catalog display and book creation are present. Issue/list handlers reference absent templates; return, copy inventory and settled fines are not implemented.

### Requirements

LIB-01 **Preserve and correct, P1:** Library operators create/edit catalog titles with name, author, ISBN and category. Store ISBN as a validated string to preserve leading zeros. Add physical book copies with unique accession codes and available/on-loan/lost/withdrawn status. A title is not a borrowable physical copy.

LIB-02 **Correct, P1:** Issue an available copy to an active student, recording operator, issue date, due date and policy version. Check proposed maximum of three active loans and absence of a blocking account status. Make copy reservation and loan creation atomic so two operators cannot issue the same copy.

LIB-03 **New, P1:** Return a loan by recording returnedAt and operator, closing the loan and restoring availability unless damaged/lost. Repeating a return is idempotent. Renewal and reservations are deferred; due-date overrides require permission and a reason.

LIB-04 **Correct, P1:** Default loan duration is 14 calendar days for planning. Due-date calculation uses the institution date. Fines are disabled until currency/rate/grace/cap policy is approved. If enabled, estimate overdueDays × dailyRate using max(0, returnDate or today minus dueDate), freezing the amount at return. The legacy rate of 5 is not automatically adopted.

LIB-05 **New, P1:** Student catalog search shows title, author, ISBN, category and actual available-copy count. Student can view only their own active/history loans and due dates. Operators see searchable issued/overdue/returned loans. A loan uses its own dates, never the first loan in a result list.

LIB-06 **New, P1:** Archive titles with historical loans; do not erase history. Record lost/damaged disposition and authorized fine waiver with reasons. Payment collection, accounting integration and automatic charges are excluded.

### Acceptance criteria

- LIB-A1: Two concurrent issue requests for one copy yield exactly one active loan.
- LIB-A2: Returning once closes the loan and restores the copy; retry creates no second return.
- LIB-A3: A loan due on 15 July and returned on 17 July has two overdue days; if an approved rate is 5, estimated fine is 10 in the configured currency.
- LIB-A4: Each issued row shows its own borrower and dates. Students cannot read another borrower's history.
- LIB-A5: Legacy ISBN-only loans stay flagged for reconciliation until a physical copy is verified; migration never invents an accession number as if confirmed.

---

## 18 MERN architecture and data design

### Proposed architecture

Use a React web client with TypeScript, an Express API on Node.js, MongoDB and object storage for media. Start with a modular monolith: identity, academic setup, people, attendance, results, requests, notifications, library and reporting modules share clear service interfaces. A background worker processes durable notification/export jobs. Avoid microservices until scale or ownership justifies the operational cost.

Request flow is React → Express authentication and validation → permission/scoping checks → domain service → MongoDB. The browser never connects directly to MongoDB. Use supported dependency versions chosen and pinned at implementation kickoff; this PRD does not prescribe unverified version numbers.

MongoDB supports atomic single-document updates and multi-document transactions. Use a replica-set-capable deployment for cross-collection atomic actions, and keep transactions small. This matters for account/profile/enrollment creation, attendance submission, publication and book issue/return. See MongoDB's transaction documentation in section 24.

### Collection boundaries

| Collections | Core relationships and constraints |
| --- | --- |
| users, sessions, resetTokens | Unique normalized email; revocable sessions; token hashes and expiry |
| staff, students | Unique userId; unique staffCode/admissionNumber |
| courses, academicSessions | Unique stable codes; dates and lifecycle state |
| subjects, offerings, enrollments | Subject/course; offering/session/teacher; student effective dates |
| attendanceSessions, attendanceRecords | Unique offering/date/slot; unique register/student |
| assessmentPolicies, resultBatches, results | Policy version; batch state; unique offering/cycle/student/revision |
| leaveRequests, feedback | Applicant/author references; state/version and decision history |
| notifications, deliveryAttempts, deviceTokens | Unique event/recipient; per-device delivery; readAt |
| books, bookCopies, loans | Title/copy separation; unique accession; at most one active loan per copy |
| auditEvents, outboxEvents, importJobs | Actor/resource events; deduplicated jobs and migration provenance |

Use referenced collections for unbounded histories; embed small policy snapshots or bounded roster metadata only when justified. Add indexes matching role/course/session/date queries. Enforce uniqueness in the database as well as API validation. Enrollment overlap requires transactional service validation; a simple unique index alone is insufficient.

Every mutable record carries createdAt, updatedAt, actor IDs and version. Academic dates are date-only institution values; operational timestamps are UTC. Preserve legacy table and ID in migration metadata. Monetary estimates use integer minor units with currency; score arithmetic must have explicit decimal precision. Never use display names as relationships.

---

## 19 API and frontend contract

All routes below are proposed `/api/v1` resources, not a transcription of Django URL names. Engineering should publish an OpenAPI contract before feature implementation. Use consistent JSON responses, explicit pagination and server-side filters. Identity is taken from the authenticated session; requesting another user's data requires an explicit permission.

| Area | Representative endpoints | Scope |
| --- | --- | --- |
| Access | POST /auth/login, /logout, /forgot-password, /reset-password; GET /me | Public limited auth actions; own identity |
| Setup | GET/POST /courses, /academic-sessions, /subjects, /offerings; PATCH /{resource}/:id | Administrator writes |
| People | GET/POST /students, /staff; PATCH /students/:id; POST /enrollments | Administrator; scoped roster reads |
| Attendance | GET /offerings/:id/roster; POST /attendance-sessions; POST /attendance-sessions/:id/submit | Assigned teacher and eligible roster |
| Corrections | PATCH /attendance-sessions/:id; POST /attendance-sessions/:id/void | Window/approval and version enforced |
| Results | PUT /result-batches/:id/draft; POST /:id/submit, /publish, /reopen | Staff drafts; administrator publication |
| Requests | GET/POST /leave-requests, /feedback; POST /leave-requests/:id/decision; PUT /feedback/:id/reply | Own submit/read; administrator decision |
| Messages | GET /notifications; PATCH /notifications/:id/read; POST /notification-batches | Own inbox; administrator dispatch |
| Profiles | PATCH /me/profile; POST /me/password, /me/photo | Own allowed fields only |
| Library | GET/POST /books; POST /book-copies, /loans; POST /loans/:id/return | Catalog read; delegated operator writes |
| Reports | GET /reports/attendance, /results; POST /exports; GET /audit-events | Role and resource scope |

### Mutation contract

Accept a client operation/idempotency key for creates and workflow transitions, with a request-content hash. Same key and payload returns the same result; same key with different content returns a conflict. Require expectedVersion for updates. Return 401 for unauthenticated access, 403 for forbidden actions, 404 for absent or deliberately concealed resources, 409 for state/version conflicts and 422 for validation errors. Never return a successful response for a partial write.

Attendance submission contains offeringId, date, slot, expectedVersion and student/status entries. Server derives actor and roster eligibility. Result publication references a reviewed batch/version rather than accepting arbitrary student scores in a publish request. Error payloads include code, safe message, fieldErrors and requestId; exclude stack traces and credentials.

React should share form, table, confirmation, empty-state and access-denied components. Preserve selected context in navigation, cancel stale requests and invalidate cached reports after committed writes. Long-running imports/exports return a job ID with progress and row-level results; do not block the browser until completion.

---

## 20 Security reliability and operational requirements

NFR-01 **P0:** Apply server validation, role/resource checks, secure cookies, CSRF defense, TLS, safe output encoding, upload restrictions and login throttling. Keep credentials in environment/secret configuration. Replace the source's embedded credential material before any deployment. Express's security guidance supports TLS, careful input handling and secure cookie settings; see section 24.

NFR-02 **P0:** Record actor, action, resource, timestamp, request ID, reason and relevant before/after values for academic changes, approvals, publication, archival, access changes and exports. Exclude credentials and unnecessary sensitive free text. Audit events cannot be edited through application APIs; only authorized administrators can query them.

NFR-03 **P0:** Proposed capacity envelope is 10,000 students, 500 staff, 200 concurrent users and five years of history. Treat this as a planning assumption to validate. At this load, target p95 standard API reads below 500 ms, ordinary writes below 1 second and a 100-student attendance submission below 2 seconds, excluding external provider time. Test with realistic indexes and data volume.

NFR-04 **P0:** Target 99.5% monthly availability excluding agreed maintenance. Proposed recovery targets are RPO 24 hours and RTO 4 hours. Schedule encrypted backups, retain a proposed 30-day recovery window and run a successful restore rehearsal before pilot. Academic retention rules are separate from backup retention and require institutional approval.

NFR-05 **P0:** Use transactional writes and a durable outbox so notifications cannot be lost between database commit and worker scheduling. Jobs retry safely with bounded backoff, failed-job visibility and operator retry. Application restarts cannot produce partial attendance or duplicate active loans.

NFR-06 **P0:** Provide structured logs, request IDs, error monitoring, health/readiness checks and alerts for sustained error rate, database failure, failed backups and delivery backlog. Logs must not contain full student records, passwords or token-bearing URLs. Deploy staging separately from production.

NFR-07 **P0:** Meet the keyboard, screen-reader labeling, focus, contrast and responsive behavior specified in UX-03. Test current supported major desktop browsers and mobile Chrome/Safari at release; support policy must be recorded in the release notes.

NFR-08 **P0:** Use synthetic data in development, scoped production access and export auditing. Institution approves data retention, hosting region, deletion requests and access responsibilities before launch. This PRD does not assert jurisdiction-specific legal compliance.

**Operational acceptance:** Demonstrate recovery from backup, failed notification retry, aborted transaction rollback, credential revocation and a load test against the agreed envelope. Zero unresolved critical/high authorization or academic-integrity findings are permitted at launch.

---

## 21 Migration and cutover

Migration is conditional on the institution choosing to retain existing records. The checked-in SQLite file must not be assumed to be an authorized production dataset. Obtain the approved source backup and data owner before migration; use sanitized data for rehearsal.

### Mapping and reconciliation

| Legacy source | Target and handling |
| --- | --- |
| CustomUser, Admin, Staff, Student | users and profiles; retain legacy IDs; normalize and reconcile duplicate emails |
| Course, Session, Subject | courses, academicSessions, subjects and offerings; infer offerings only where session evidence is sufficient |
| Student.course/session | Initial enrollment; historical transfers need external records or an explicit unknown-history flag |
| Attendance, AttendanceReport | registers and records; reconcile duplicate subject/session/date and student rows before assigning a slot |
| StudentResult | Legacy result staging; missing session/cycle cannot be guessed silently from current enrollment |
| Student/staff leave and feedback | Unified collections with author role; map 0/1/-1 to pending/approved/rejected; parse invalid dates into exception queue |
| Notifications and fcm_token | In-app history; re-register devices with consent rather than assuming old tokens are usable |
| Book, IssuedBook, Library | Catalog and quarantined loan candidates; reconcile ISBNs, borrowers, physical copies and conflicting relationships |
| Profile media | Controlled object storage; validate files and map missing images to default avatar |

### Migration process

MIG-01 **P0:** Inventory source schema/counts, duplicate identifiers, null relationships, date anomalies and media references. Create a signed exception register. Do not log personal rows in general build output.

MIG-02 **P0:** Build repeatable transforms using legacy table/ID keys and migration batch IDs. Dry run to staging, reconcile source accepted + quarantined + intentionally excluded counts against extracted counts. Compare attendance totals and result values, not only record counts.

MIG-03 **P0:** Do not copy Django password hashes into an incompatible verifier. Preferred cutover is account activation/reset. A transitional hash verifier requires a separate reviewed design; no plaintext passwords are extracted.

MIG-04 **P0:** Freeze legacy writes for the agreed cutover window, capture a final backup, run the final migration, reconcile and obtain academic-owner signoff. Verify representative student journeys and every module's exception totals before enabling new writes.

MIG-05 **P0:** Roll back before opening new writes if reconciliation or critical journeys fail. After new writes begin, rollback requires exporting/replaying the new system's changes or controlled recovery; restoring the old backup alone would lose data. Define the decision owner and maximum outage in the cutover runbook.

**Acceptance:** All imported relationships resolve; every quarantined record has an owner and disposition; accepted totals reconcile with zero unexplained differences. Repeating a migration batch creates no duplicates. Historic results with unresolved academic periods remain explicitly labeled and excluded from official new-session publications.

---

## 22 Delivery plan and definition of done

### Sequenced delivery

This is a dependency-based plan, not a committed date estimate. Estimate after section 23 decisions and a technical discovery spike. A suggested core team is a product/academic lead, designer, technical lead, two to three full-stack engineers and QA, with part-time infrastructure support.

| Gate | Delivery | Exit evidence |
| --- | --- | --- |
| G0 product baseline | Agree academic structure, permissions, score/leave policies, data scope and prototype journeys | Signed decision register, scope and backlog |
| G1 foundation | Identity, authorization, profiles, audit, courses, sessions, people and offerings | Role tests; complete setup-to-enrollment journey |
| G2 academic core | Attendance, dashboard calculations, results and publication | Transaction/concurrency tests; academic-owner result verification |
| G3 service workflows | Leave, feedback, in-app notifications and monitoring | End-to-end role UAT; failure/retry evidence |
| G4 pilot readiness | Migration rehearsal, recovery, performance, training and support | All P0 gates passed; one course/session launched |
| G5 complete release | Library issue/return, push, bulk onboarding and exports | All P1 criteria; pilot defects resolved; phased rollout approval |

### Test and acceptance strategy

QA maintains a traceability matrix from each requirement ID to test case and evidence. Use unit tests for score/date/attendance calculations and state transitions; API integration tests for permissions, validation and transactions; browser tests for role journeys; concurrency tests for duplicate attendance, stale scores and issuing one copy twice. Do not rely on happy-path screenshots alone.

UAT uses an administrator, two teachers, at least two courses, two academic sessions, enrolled/transferred/withdrawn students and a library operator. Include a missing subject, a zero score, an absent assessment, an empty attendance period, a rejected leave, a failed push and a legacy result without session evidence.

### Definition of done

- All P0 requirements implemented and accepted by the named owner before the pilot; all P1 requirements before the complete release.
- No critical/high unresolved authorization, data-loss or academic-calculation defects. No orphan records or unexplained migration differences.
- Permission checks enforced in API tests; every sensitive mutation creates an audit event.
- Accessibility and mobile journeys reviewed; failure/retry behavior verified and no unsupported “success” states.
- Approved API contract, deployment/configuration guide, backup/restore runbook, migration report and user guides delivered.
- Pilot users trained; support owner, incident escalation, rollback authority and monitoring dashboard available.

Pilot expansion is a product decision based on adoption, record accuracy and support burden. A successful build alone does not establish institutional readiness.

---

## 23 Decisions risks and future scope

### Decisions required before dependent work

| Decision | Proposed baseline | Owner and deadline |
| --- | --- | --- |
| D01 Institution model | One institution; HOD/admin has institution-wide rights | Sponsor and product owner at G0 |
| D02 Academic structure | Course + session; one cohort; compulsory subjects | Academic head before offerings schema |
| D03 Semesters, sections and electives | Deferred; add now only if essential for pilot | Academic head before G1 |
| D04 Attendance policy | Present/Absent; no automatic leave exemption; 48-hour correction window | Academic head before G2 |
| D05 Results policy | Test 40/exam 60; admin publication; no inferred grades/GPA | Examination owner before G2 |
| D06 Leave dates and approvers | Date ranges; admin approval; past requests flagged | Academic/HR owner before G3 |
| D07 Privacy and account policy | Optional image/gender; verified email changes; revocable sessions | Institution/security owner before G1 |
| D08 Library policy | 14-day loans; three-loan limit; fines disabled until approved | Librarian before G5 |
| D09 Migration scope | Approved source only; unresolved history quarantined | Data/academic owner before G4 |
| D10 Hosting and service levels | Capacity/recovery assumptions from section 20 | Technical/sponsor owners before G1 |

### Material risks

The largest product risk is misunderstanding “course” and “session.” Introducing real semesters, elective selection or multiple sections late changes roster and result identity. Resolve D02/D03 before implementing academic transactions. Migration has a separate risk: current student enrollment cannot prove which year a legacy result belongs to. An academic data owner must resolve that ambiguity.

Publication introduces an administrator workload absent from the legacy flow. Validate the queue and batch-review experience in the pilot. Notification reliability depends on provider setup and user consent; in-app records remain authoritative. Library records lack physical copy identity, so circulation requires a stock reconciliation before rollout.

### Future module briefs

The README names fees, timetable, online exams, parent portal, SMS and advanced analytics as future work. They are P2 discovery items, not hidden commitments in this rebuild.

- **Fees:** finance owner defines fee plans, dues, concessions, receipts, refunds and reconciliation; payment-provider integration needs its own requirements and controls.
- **Timetable:** academic owner defines rooms, periods, teacher availability, clashes and publication; use published schedules for attendance completeness later.
- **Online exams:** examination owner defines question banks, attempts, timing, scoring and integrity controls; do not equate result entry with exam delivery.
- **Parent portal:** verify guardian-student relationships and consent; define visibility independently of student credentials.
- **SMS and advanced analytics:** define opt-in audiences, costs, delivery reporting and approved metrics before selecting services.

Each future module needs its own acceptance criteria, owner and capacity allocation before entering a release.

---

## 24 Source traceability and technical references

### Review provenance

Source root: C:\Users\KisholoyRoy\Downloads\College-ERP-main\College-ERP-main. Review date: 2 November 2026. Evidence references below are repository-relative paths and inspected function/model names, allowing the team to locate the implementation without relying on screenshots. The source checkout was not modified. Bundled third-party UI libraries and the historical project-report PDF were not treated as current functional authority.

| Requirements | Source evidence |
| --- | --- |
| IAM, AUTHZ | main_app/views.py: login_page, doLogin, logout_user; EmailBackend.py; middleware.py; college_management_system/urls.py |
| DASH | hod_views.py: admin_home; staff_views.py: staff_home; student_views.py: student_home; role home templates |
| CRS, SES | models.py: Course, Session; forms.py: CourseForm, SessionForm; hod_views.py: add/manage/edit/delete_course and session handlers |
| STF, STU | models.py: CustomUser, Admin, Staff, Student and profile signals; forms.py: StaffForm, StudentForm; hod_views.py: people CRUD |
| SUB | models.py: Subject; forms.py: SubjectForm; hod_views.py: subject CRUD; staff_views.py: subject filtering |
| ATT | models.py: Attendance, AttendanceReport; staff_views.py: take/save/update/get handlers; views.py: get_attendance; HOD/student attendance handlers |
| RES | models.py: StudentResult; staff_views.py: staff_add_result, fetch_student_result; EditResultView.py; staff_add_result.html; student_view_result.html |
| LEV | models.py: LeaveReportStudent/Staff; forms.py: leave forms; student/staff apply_leave; hod_views.py: view_student_leave, view_staff_leave |
| FDB | models.py: FeedbackStudent/Staff; feedback forms; student/staff feedback; hod_views.py: feedback_message handlers |
| NOT | models.py: NotificationStudent/Staff and fcm_token; hod_views.py: notify/send handlers; student/staff inbox/token handlers; views.py: showFirebaseJS |
| PRO | student/staff/HOD view_profile handlers; forms.py: AdminForm, StudentEditForm, StaffEditForm |
| LIB | models.py: Book, Library, IssuedBook, expiry; forms.py: IssueBookForm; staff_views.py: add_book, issue_book, view_issued_book; student_views.py: view_books |
| NFR, MIG | models.py relationships; middleware.py; settings.py; requirements.txt; main_app/tests.py; route/template consistency |
| P2 scope | README.md Roadmap; main_app/urls.py and models.py distinguish implemented scope from aspirations |

### Technical references checked for the proposed rebuild

- MongoDB transactions: https://www.mongodb.com/docs/manual/core/transactions/ — supports the atomic-write and transaction recommendations in section 18.
- Express production security: https://expressjs.com/advanced/best-practice-security/ — supports TLS, input handling and cookie configuration in section 20.
- Firebase HTTP v1 sending: https://firebase.google.com/docs/cloud-messaging/send/v1-api — supports replacing legacy server-key sending in section 16.

