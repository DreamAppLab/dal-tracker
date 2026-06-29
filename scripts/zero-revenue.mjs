import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../src/firebase.js';

const COLLECTION = 'projects';

const snapshot = await getDocs(collection(db, COLLECTION));
let count = 0;

for (const snap of snapshot.docs) {
  const data = snap.data();
  const revenue = data.revenue || {};
  await updateDoc(doc(db, COLLECTION, snap.id), {
    revenue: { ...revenue, monthly: 0, total: 0 },
  });
  console.log(`Zeroed revenue for ${snap.id}`);
  count++;
}

console.log(`Updated ${count} project(s)`);
process.exit(0);
