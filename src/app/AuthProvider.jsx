import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { todayIn } from '../lib/calc';

const Ctx = createContext(null);
export const useCtx = () => useContext(Ctx);

const EMPTY = { loading: false, user: null, profile: null, institution: null, error: '' };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ...EMPTY, loading: true });

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return setState(EMPTY);
        const reject = async (error) => {
          await signOut(auth);
          setState({ ...EMPTY, error });
        };
        try {
          const snap = await getDoc(doc(db, 'users', user.uid));
          const profile = snap.exists() ? snap.data() : null;
          if (!profile || !profile.active) return reject('This account is not active. Contact your college admin.');
          let institution = null;
          if (profile.role !== 'PLATFORM_ADMIN') {
            try {
              const inst = await getDoc(doc(db, 'institutions', profile.institutionId));
              institution = { id: inst.id, ...inst.data() };
            } catch {
              return reject('This college is suspended or unavailable. Contact the platform owner.');
            }
          }
          setState({ loading: false, user, profile, institution, error: '' });
        } catch {
          reject('Could not load your account.');
        }
      }),
    [],
  );

  const value = useMemo(() => {
    const { user, profile, institution } = state;
    const tz = institution?.timezone ?? 'UTC';
    return {
      ...state,
      uid: user?.uid,
      role: profile?.role,
      iid: profile?.institutionId,
      timezone: tz,
      today: () => todayIn(tz),
      logout: () => signOut(auth),
    };
  }, [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
