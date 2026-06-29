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

const edits = rvvault.edits;
const ref = doc(db, COLLECTION, PROJECT_ID);

const snap = await getDoc(ref);
if (!snap.exists()) {
  console.error(`Document "${PROJECT_ID}" not found in Firestore collection "${COLLECTION}"`);
  process.exit(1);
}

await updateDoc(ref, { edits });

console.log(
  `Success: replaced edits on projects/${PROJECT_ID} with ${edits.length} item(s) from initialData.js`
);
process.exit(0);
