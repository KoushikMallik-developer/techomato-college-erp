import { useState } from 'react';
import { query, where } from 'firebase/firestore';
import { useCtx } from '../../app/AuthProvider';
import { ROLES, isAdminRole, tcol } from '../../lib/tenant';
import { list } from '../../lib/data';
import FilePanel from '../../components/FilePanel';
import { Alert, Loading, PageHeader, Select, useAsync } from '../../components/ui';

export default function Materials() {
  const { iid, role, uid, profile } = useCtx();
  const [assignmentId, setAssignmentId] = useState('');
  const { data, loading, error } = useAsync(async () => {
    if (isAdminRole(role)) return list(tcol(iid, 'teachingAssignments'));
    if (role === ROLES.FACULTY) {
      return list(query(tcol(iid, 'teachingAssignments'), where('facultyId', '==', profile.facultyId), where('active', '==', true)));
    }
    // Student: the classes of their active enrollment (same section and semester).
    const enrollments = await list(query(tcol(iid, 'enrollments'), where('studentId', '==', profile.studentId), where('status', '==', 'ACTIVE')));
    const groups = await Promise.all(enrollments.map((e) =>
      list(query(tcol(iid, 'teachingAssignments'), where('semesterId', '==', e.semesterId), where('sectionId', '==', e.sectionId)))));
    return groups.flat();
  }, [iid]);

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error.message}</Alert>;
  const a = data.find((x) => x.id === assignmentId);
  const teacherMayUpload = role === ROLES.FACULTY || isAdminRole(role);
  return (
    <>
      <PageHeader title="Class materials" />
      <div className="row" style={{ marginBottom: 12 }}>
        <Select label="Class" value={assignmentId} onChange={setAssignmentId}
          options={data.map((x) => ({ value: x.id, label: `${x.subjectName} — ${x.facultyName}${x.active ? '' : ' (ended)'}` }))} />
      </div>
      {data.length === 0 && <Alert kind="info">No classes found.</Alert>}
      {a && (
        <div className="card">
          <h2>{a.subjectName}</h2>
          <FilePanel
            key={a.id}
            collection="teachingAssignments"
            ownerId={a.id}
            kind="MATERIAL"
            // A replaced teacher can no longer upload; admins can always.
            canUpload={isAdminRole(role) || (teacherMayUpload && a.active)}
            canRemove={(f) => isAdminRole(role) || (a.active && f.uploadedBy === uid)}
          />
        </div>
      )}
    </>
  );
}
