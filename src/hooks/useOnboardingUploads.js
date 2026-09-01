import { useEffect, useState } from 'react';
import { collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { dalCrmDb } from '../firebaseDalCrm';

/**
 * Real-time listener for unreviewed onboarding file uploads across all
 * clients in the DAL CRM project (fieldbase-prod-42be2).
 *
 * Listens to clients/{clientId}/onboarding/ where:
 *   status == 'uploaded' AND reviewedBy == null
 *
 * Requires REACT_APP_DALCRM_FIREBASE_API_KEY to be set, and the
 * fieldbase-prod-42be2 Firestore rules to allow reading onboarding
 * collection groups without authentication (or with the web client).
 *
 * Also requires a Firestore collection-group index on 'onboarding'
 * for (status ASC, reviewedBy ASC). Firebase will log an index-creation
 * link in the console if it's missing.
 *
 * Returns:
 *   uploadsByClientId  — { [clientId]: upload[] }  (unreviewed uploads)
 *   totalCount         — total number of unreviewed uploads
 */
export function useOnboardingUploads() {
  const [uploadsByClientId, setUploadsByClientId] = useState({});
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (!dalCrmDb) return;

    let q;
    try {
      q = query(
        collectionGroup(dalCrmDb, 'onboarding'),
        where('status', '==', 'uploaded'),
        where('reviewedBy', '==', null)
      );
    } catch (err) {
      console.warn('[OnboardingUploads] Failed to build query:', err.message);
      return;
    }

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const byClientId = {};
        snapshot.docs.forEach((docSnap) => {
          const clientId = docSnap.ref.parent.parent?.id;
          if (!clientId) return;
          if (!byClientId[clientId]) byClientId[clientId] = [];
          byClientId[clientId].push({ id: docSnap.id, clientId, ...docSnap.data() });
        });
        setUploadsByClientId(byClientId);
        setTotalCount(snapshot.size);
      },
      (err) => {
        // Silently warn — missing index or missing permissions will surface here.
        console.warn('[OnboardingUploads] Listener error:', err.message);
      }
    );

    return () => unsub();
  }, []);

  return { uploadsByClientId, totalCount };
}
