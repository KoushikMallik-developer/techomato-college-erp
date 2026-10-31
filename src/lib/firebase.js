import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
const useEmulator = env.VITE_USE_EMULATOR === 'true';

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);

// App Check: the SDK attaches its token to Firestore calls. Skipped when no site key is set.
export const appCheck = env.VITE_APPCHECK_SITE_KEY && !useEmulator
  ? initializeAppCheck(app, { provider: new ReCaptchaV3Provider(env.VITE_APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true })
  : null;

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

let secondaryReady = false;

// A second app instance lets an admin create an Auth user without being signed out.
export function secondaryAuth() {
  const name = 'secondary';
  const secondary = getApps().find((a) => a.name === name) ?? initializeApp(config, name);
  const secAuth = getAuth(secondary);
  if (useEmulator && !secondaryReady) {
    connectAuthEmulator(secAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  secondaryReady = true;
  return secAuth;
}
