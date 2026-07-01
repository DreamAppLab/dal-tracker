import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../src/firebase.js';

const PROJECT_ID = 'familywatch';
const COLLECTION = 'projects';

const ref = doc(db, COLLECTION, PROJECT_ID);
const snap = await getDoc(ref);

if (!snap.exists()) {
  console.error(`Document "${PROJECT_ID}" not found in Firestore collection "${COLLECTION}"`);
  process.exit(1);
}

const currentName = snap.data().name;
if (currentName === 'FamilyLens') {
  console.log(`projects/${PROJECT_ID} display name is already "FamilyLens"`);
  process.exit(0);
}

await updateDoc(ref, { name: 'FamilyLens' });
console.log(`Updated projects/${PROJECT_ID} display name: "${currentName}" → "FamilyLens"`);
process.exit(0);
