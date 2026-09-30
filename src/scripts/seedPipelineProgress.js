import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const STATUS_REF = doc(db, 'blackbox_global', 'pipeline_progress_seed');

function ids(...groups) {
  return groups.flat();
}

const FAMILYTHREAD = ids(
  ['p1t1', 'p1t2', 'p1t3', 'p1t4', 'p1t5', 'p1t6', 'p1t7', 'p1t8', 'p1t9', 'p1t10', 'p1t11'],
  ['p2t1', 'p2t2', 'p2t3', 'p2t4', 'p2t5', 'p2t6', 'p2t7', 'p2t8', 'p2t9', 'p2t10', 'p2t11', 'p2t12', 'p2t13', 'p2t14', 'p2t15', 'p2t16'],
  ['p3t1', 'p3t2', 'p3t3', 'p3t4', 'p3t5', 'p3t6', 'p3t7', 'p3t8', 'p3t9', 'p3t10', 'p3t11', 'p3t12', 'p3t13', 'p3t14', 'p3t15', 'p3t16', 'p3t17', 'p3t18', 'p3t19', 'p3t20', 'p3t21', 'p3t22', 'p3t23', 'p3t24', 'p3t25', 'p3t26', 'p3t27', 'p3t28', 'p3t29', 'p3t30', 'p3t31', 'p3t32', 'p3t33'],
  ['p4t1', 'p4t2', 'p4t3', 'p4t4', 'p4t5', 'p4t6', 'p4t7', 'p4t8', 'p4t10', 'p4t11', 'p4t12', 'p4t13', 'p4t14', 'p4t15', 'p4t16', 'p4t17', 'p4t18', 'p4t19', 'p4t20', 'p4t21', 'p4t22', 'p4t23', 'p4t24', 'p4t25', 'p4t26', 'p4t27', 'p4t28'],
  ['p6t1', 'p6t2', 'p6t5', 'p6t6', 'p6t7', 'p6t8', 'p6t10', 'p6t11', 'p6t12', 'p6t13'],
  ['p7t1', 'p7t2', 'p7t3', 'p7t4', 'p7t6', 'p7t7'],
  ['p8t1', 'p8t2', 'p8t3', 'p8t4', 'p8t5', 'p8t6'],
  ['p9t1', 'p9t2', 'p9t3', 'p9t4', 'p9t5', 'p9t6', 'p9t7', 'p9t9', 'p9t10', 'p9t11'],
  ['p10t1', 'p10t2'],
  ['p11t1', 'p11t2', 'p11t3', 'p11t4', 'p11t5', 'p11t6', 'p11t7', 'p11t8', 'p11t9', 'p11t10', 'p11t11', 'p11t12', 'p11t13'],
  ['p12t1', 'p12t2', 'p12t3', 'p12t4', 'p12t5', 'p12t6', 'p12t7', 'p12t8', 'p12t9', 'p12t10', 'p12t11', 'p12t12'],
  ['p13t1', 'p13t2', 'p13t3', 'p13t4', 'p13t5', 'p13t6', 'p13t7', 'p13t8', 'p13t9'],
  ['p14t1', 'p14t2', 'p14t3', 'p14t4', 'p14t5']
);

const TRAVELWHIRL = ids(
  ['p1t1', 'p1t2', 'p1t3', 'p1t4', 'p1t5', 'p1t6', 'p1t7', 'p1t8', 'p1t9', 'p1t10', 'p1t11'],
  ['p2t1', 'p2t2', 'p2t3', 'p2t4', 'p2t5', 'p2t6', 'p2t7', 'p2t8', 'p2t9', 'p2t10', 'p2t11', 'p2t12', 'p2t13', 'p2t14', 'p2t15', 'p2t16'],
  ['p3t1', 'p3t2', 'p3t3', 'p3t4', 'p3t5', 'p3t6', 'p3t7', 'p3t8', 'p3t9', 'p3t10', 'p3t11', 'p3t12', 'p3t13', 'p3t14', 'p3t15', 'p3t16', 'p3t17', 'p3t18', 'p3t19', 'p3t20', 'p3t21', 'p3t22', 'p3t23', 'p3t24', 'p3t25', 'p3t26', 'p3t27', 'p3t28', 'p3t29', 'p3t30', 'p3t31', 'p3t32', 'p3t33'],
  ['p4t1', 'p4t2', 'p4t3', 'p4t4', 'p4t5', 'p4t6', 'p4t7', 'p4t8', 'p4t9', 'p4t10', 'p4t11', 'p4t12', 'p4t13', 'p4t14', 'p4t15', 'p4t16', 'p4t17', 'p4t18', 'p4t19', 'p4t20', 'p4t21', 'p4t22', 'p4t23', 'p4t24', 'p4t25', 'p4t26', 'p4t27', 'p4t28'],
  ['p6t1', 'p6t2', 'p6t5', 'p6t6', 'p6t7', 'p6t8', 'p6t10', 'p6t11', 'p6t12', 'p6t13'],
  ['p7t1', 'p7t2', 'p7t3', 'p7t4', 'p7t6', 'p7t7'],
  ['p8t1', 'p8t2', 'p8t3', 'p8t4', 'p8t5', 'p8t6'],
  ['p9t1', 'p9t2', 'p9t3', 'p9t4', 'p9t5', 'p9t6', 'p9t7', 'p9t9', 'p9t10', 'p9t11'],
  ['p10t1', 'p10t2'],
  ['p11t1', 'p11t2', 'p11t3', 'p11t4', 'p11t5', 'p11t6', 'p11t7', 'p11t8', 'p11t9', 'p11t10', 'p11t11', 'p11t12', 'p11t13'],
  ['p12t1', 'p12t2', 'p12t3', 'p12t4', 'p12t5', 'p12t6', 'p12t7', 'p12t8', 'p12t9', 'p12t10', 'p12t11', 'p12t12'],
  ['p13t1', 'p13t2', 'p13t3', 'p13t4', 'p13t5', 'p13t6', 'p13t7', 'p13t8', 'p13t9'],
  ['p14t1', 'p14t2', 'p14t3', 'p14t4', 'p14t5']
);

// FamilyLens is rejected — p14t5 (Submit for Review) stays incomplete.
const FAMILYLENS = FAMILYTHREAD.filter((id) => id !== 'p14t5');

const FLAREPAD = ids(
  ['p1t1', 'p1t2', 'p1t3', 'p1t4', 'p1t5', 'p1t6', 'p1t7', 'p1t8', 'p1t9', 'p1t10', 'p1t11'],
  ['p2t1', 'p2t2', 'p2t3', 'p2t4', 'p2t5', 'p2t6', 'p2t7', 'p2t8', 'p2t9', 'p2t10', 'p2t11', 'p2t12', 'p2t13', 'p2t14', 'p2t15', 'p2t16'],
  ['p3t1', 'p3t2', 'p3t3', 'p3t4', 'p3t5', 'p3t6', 'p3t7', 'p3t8', 'p3t9', 'p3t10', 'p3t11', 'p3t12', 'p3t13', 'p3t14', 'p3t15', 'p3t16', 'p3t17', 'p3t18', 'p3t19', 'p3t20', 'p3t21', 'p3t22', 'p3t23', 'p3t24', 'p3t25', 'p3t26', 'p3t27', 'p3t28', 'p3t29', 'p3t30', 'p3t31', 'p3t32', 'p3t33'],
  ['p4t1', 'p4t2', 'p4t3', 'p4t4', 'p4t5', 'p4t8', 'p4t10', 'p4t11', 'p4t12', 'p4t14', 'p4t15', 'p4t16', 'p4t17', 'p4t18', 'p4t19', 'p4t20', 'p4t25'],
  ['p6t1', 'p6t5', 'p6t6', 'p6t7', 'p6t8', 'p6t10', 'p6t11', 'p6t12'],
  ['p7t1', 'p7t2', 'p7t3', 'p7t4'],
  ['p8t1', 'p8t2', 'p8t3', 'p8t4', 'p8t5', 'p8t6'],
  ['p9t1', 'p9t2', 'p9t3', 'p9t4', 'p9t5', 'p9t9', 'p9t10', 'p9t11'],
  ['p11t2', 'p11t3', 'p11t4', 'p11t5'],
  ['p12t1', 'p12t2', 'p12t3', 'p12t4', 'p12t5', 'p12t6', 'p12t9', 'p12t10', 'p12t11', 'p12t12'],
  ['p13t1', 'p13t2', 'p13t3', 'p13t4', 'p13t5', 'p13t6', 'p13t7', 'p13t8'],
  ['p14t1', 'p14t2', 'p14t3', 'p14t4', 'p14t5']
);

const LOGABODE = FLAREPAD;

function matchCompletedTaskIds(projectId) {
  const id = String(projectId || '').toLowerCase();
  if (id.includes('familythread')) return FAMILYTHREAD;
  if (id.includes('travelwhirl')) return TRAVELWHIRL;
  if (id.includes('familylens') || id.includes('familywatch')) return FAMILYLENS;
  if (id.includes('flarepad')) return FLAREPAD;
  if (id.includes('logabode')) return LOGABODE;
  return null;
}

function completedMap(taskIds) {
  const completed = {};
  taskIds.forEach((taskId) => {
    completed[taskId] = true;
  });
  return completed;
}

export async function getPipelineProgressSeedStatus() {
  const snap = await getDoc(STATUS_REF);
  if (!snap.exists()) return { seeded: false };
  return snap.data();
}

/**
 * One-time seed: mark completed app-pipeline tasks as of August 19, 2026.
 * Every write uses setDoc({ merge: true }).
 */
export async function runSeedPipelineProgress() {
  const snap = await getDocs(collection(db, 'projects'));
  const logs = [];

  for (const projectDoc of snap.docs) {
    const data = projectDoc.data() || {};
    const name = data.name || projectDoc.id;
    const taskIds = matchCompletedTaskIds(projectDoc.id);

    if (!taskIds) {
      const line = `${name}: skipped (no matching app)`;
      logs.push(line);
      console.log(line);
      continue;
    }

    const completed = completedMap(taskIds);
    await setDoc(
      doc(db, 'projects', projectDoc.id, 'pipeline', 'app'),
      {
        completed,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    const line = `${name}: marked ${taskIds.length} tasks complete`;
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
  window.runSeedPipelineProgress = runSeedPipelineProgress;
}
