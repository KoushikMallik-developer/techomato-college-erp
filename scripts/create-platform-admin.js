// Creates a Platform Admin (the SaaS owner). Run once on your own machine.
// Usage: node scripts/create-platform-admin.js [username-or-email] ["Name"] [password]
// Defaults: admin / "Platform Admin" / admin123. Change that password after the first sign-in.
// Needs GOOGLE_APPLICATION_CREDENTIALS (service-account key kept OUTSIDE the repo),
// or FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST plus GCLOUD_PROJECT for the emulators.
import admin from 'firebase-admin';
import { loginEmail } from '../src/lib/calc.js';

const [login = 'admin', name = 'Platform Admin', password = 'admin123'] = process.argv.slice(2);
const email = loginEmail(login);

admin.initializeApp();
const user = await admin.auth().createUser({ email, displayName: name, password });
await admin.firestore().doc(`users/${user.uid}`).set({
  institutionId: 'platform',
  role: 'PLATFORM_ADMIN',
  displayName: name,
  email,
  active: true,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
});
console.log(`Created platform admin. Sign in as "${login}" with the password you gave. Change it right away.`);
