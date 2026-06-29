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

// 1. Read current edits from Firestore
const firestoreEdits = snap.data().edits || [];

// 2. Get edits from initialData.js
const initialEdits = rvvault.edits || [];

// 3. Compare by id — only keep initialData edits not already in Firestore
const existingIds = new Set(firestoreEdits.map((edit) => edit.id));
const newEdits = initialEdits.filter((edit) => !existingIds.has(edit.id));

// 4. Merge: existing preserved, new ones appended
const mergedEdits = [...firestoreEdits, ...newEdits];

if (newEdits.length > 0) {
  await updateDoc(ref, { edits: mergedEdits });
}

// 5. Log how many were added
console.log(`Added ${newEdits.length} edit(s) to projects/${PROJECT_ID} (${firestoreEdits.length} → ${mergedEdits.length} total)`);
process.exit(0);
