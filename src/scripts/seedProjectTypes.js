import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const STATUS_REF = doc(db, 'blackbox_global', 'project_types_seed');

function inferProjectType(projectId) {
  const id = String(projectId || '').toLowerCase();
  if (id.includes('familythread')) return 'Own App';
  if (id.includes('travelwhirl')) return 'Own App';
  if (id.includes('familylens') || id.includes('familywatch')) return 'Own App';
  if (id.includes('flarepad')) return 'Own App';
  if (id.includes('logabode')) return 'Own App';
  if (id.includes('dal-site') || id.includes('dal-website') || id.includes('dreamapplab')) return 'Website';
  if (id.includes('dal-tracker') || id.includes('mission-control')) return 'Own App';
  if (id.includes('shadyduck') || id.includes('shady-duck')) return 'Own App';
  if (id.includes('brynmawr')) return 'Client Job';
  return null;
}

export async function getProjectTypesSeedStatus() {
  const snap = await getDoc(STATUS_REF);
  if (!snap.exists()) return { seeded: false };
  return snap.data();
}

/**
 * One-time seed: set projectType on known DAL projects when missing.
 * Every write uses setDoc({ merge: true }).
 */
export async function runSeedProjectTypes() {
  const snap = await getDocs(collection(db, 'projects'));
  const logs = [];

  for (const projectDoc of snap.docs) {
    const data = projectDoc.data() || {};
    const name = data.name || projectDoc.id;
    const nextType = inferProjectType(projectDoc.id);

    if (!nextType) {
      const line = `${name}: skipped (no matching rule)`;
      logs.push(line);
      console.log(line);
      continue;
    }

    if (data.projectType) {
      const line = `${name}: skipped (already ${data.projectType})`;
      logs.push(line);
      console.log(line);
      continue;
    }

    await setDoc(
      doc(db, 'projects', projectDoc.id),
      { projectType: nextType },
      { merge: true }
    );
    const line = `${name}: set projectType to ${nextType}`;
    logs.push(line);
    console.log(line);
  }

  await setDoc(
    STATUS_REF,
    { seeded: true, seededAt: new Date().toISOString() },
    { merge: true }
  );

  return { ok: true, logs };
}

if (typeof window !== 'undefined') {
  window.runSeedProjectTypes = runSeedProjectTypes;
}
