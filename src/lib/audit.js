// Client helpers that record actions in the server-only auditLog.
// The browser can never write auditLog directly (Firestore rules deny it);
// these go through the authenticated /api/audit/event function.

import { deleteDoc } from 'firebase/firestore';
import { apiFetch } from './apiClient';

export async function recordAuditEvent(type, target, meta) {
  try {
    const res = await apiFetch('/api/audit/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, target, meta }),
    });
    if (!res.ok) console.warn('audit event not recorded', res.status);
  } catch (e) {
    console.warn('audit event not recorded', e && e.message);
  }
}

/** deleteDoc() + an auditLog entry for the deleted document path. */
export async function auditedDeleteDoc(ref, meta) {
  await deleteDoc(ref);
  await recordAuditEvent('delete', ref.path, meta);
}
