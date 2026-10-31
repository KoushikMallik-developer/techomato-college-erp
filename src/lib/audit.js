import { doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { tcol } from './tenant';

// Adds a NEW audit entry to the batch and returns its id. Rules require the id to be unused,
// so one entry can never cover several writes.
export function audit(batch, ctx, action, entityType, entityId, metadata = {}) {
  const ref = doc(tcol(ctx.iid, 'auditLogs'));
  batch.set(ref, {
    actorUid: ctx.uid,
    action,
    entityType,
    entityId,
    metadata,
    timestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function platformAudit(batch, uid, action, institutionId, metadata = {}) {
  const ref = doc(collection(db, 'platformAuditLogs'));
  batch.set(ref, { actorUid: uid, action, institutionId, metadata, timestamp: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}
