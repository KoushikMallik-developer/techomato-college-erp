// Creates the first Platform Admin (the SaaS owner). Run once, on your own machine.
// Usage: node scripts/create-platform-admin.js you@example.com "Your Name"
// Needs GOOGLE_APPLICATION_CREDENTIALS (service-account key kept OUTSIDE the repo),
// or FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST plus GCLOUD_PROJECT for the emulators.
import admin from 'firebase-admin';

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: node scripts/create-platform-admin.js <email> "<name>"');
  process.exit(1);
}

admin.initializeApp();
const user = await admin.auth().createUser({ email, displayName: name });
await admin.firestore().doc(`users/${user.uid}`).set({
  institutionId: 'platform',
  role: 'PLATFORM_ADMIN',
  displayName: name,
  email,
  active: true,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
});
const link = await admin.auth().generatePasswordResetLink(email);
console.log(`Created ${email} (uid ${user.uid}). Open this link to set the password:\n${link}`);
