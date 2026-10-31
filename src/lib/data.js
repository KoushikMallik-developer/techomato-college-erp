import { getDocs } from 'firebase/firestore';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { auth, secondaryAuth } from './firebase';

export const list = async (q) => (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
export const byId = (docs) => Object.fromEntries(docs.map((d) => [d.id, d]));
export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Creates the Auth account with a random password nobody sees; the person sets their own
// through the reset email. Runs on a second app instance so the admin stays signed in.
export async function createAuthUser(email) {
  const secondary = secondaryAuth();
  const password = crypto.randomUUID() + crypto.randomUUID();
  const cred = await createUserWithEmailAndPassword(secondary, email, password);
  await signOut(secondary);
  return cred.user.uid;
}

export const sendSetPasswordEmail = (email) => sendPasswordResetEmail(auth, email);

export const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
