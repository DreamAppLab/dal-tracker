import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../src/firebase.js';
import { INITIAL_PROJECTS } from '../src/data/initialData.js';

const PROJECT_ID = 'rvvault';
const COLLECTION = 'projects';

const rvvault = INITIAL_PROJECTS.find((p) => p.id === PROJECT_ID);
if (!rvvault) {
  console.error(`Project "${PROJECT_ID}" not found in initialData.js`);
  process.exit(1);
}

const ref = doc(db, COLLECTION, PROJECT_ID);
const snap = await getDoc(ref);
if (!snap.exists()) {
  console.error(`Document "${PROJECT_ID}" not found in Firestore collection "${COLLECTION}"`);
  process.exit(1);
}

const existingEdits = snap.data().edits || [];
const existingIds = new Set(existingEdits.map((e) => e.id));
const toAppend = (rvvault.edits || []).filter((e) => !existingIds.has(e.id));
const mergedEdits = [...existingEdits, ...toAppend];

if (toAppend.length === 0) {
  console.log(
    `Success: no new edits to append on projects/${PROJECT_ID} (${existingEdits.length} existing item(s))`
  );
  process.exit(0);
}

await updateDoc(ref, { edits: mergedEdits });

console.log(
  `Success: appended ${toAppend.length} edit(s) to projects/${PROJECT_ID} (${existingEdits.length} existing + ${toAppend.length} new = ${mergedEdits.length} total)`
);
process.exit(0);
