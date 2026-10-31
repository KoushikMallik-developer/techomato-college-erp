import { useCallback, useEffect, useState } from 'react';
import { getDocs, limit, query, startAfter } from 'firebase/firestore';

export const PAGE = 25;

// Cursor pagination. build() returns the base query (filters + stable ordering).
export function usePaged(build, deps) {
  const [state, setState] = useState({ rows: [], last: null, more: false, loading: true, error: null });

  const fetchPage = useCallback(async (after) => {
    const base = build();
    const snap = await getDocs(after ? query(base, startAfter(after), limit(PAGE)) : query(base, limit(PAGE)));
    return { rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), last: snap.docs.at(-1) ?? null, more: snap.size === PAGE };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const first = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchPage(null).then(
      (p) => setState({ ...p, loading: false, error: null }),
      (error) => setState({ rows: [], last: null, more: false, loading: false, error }),
    );
  }, [fetchPage]);

  useEffect(first, [first]);

  const loadMore = async () => {
    const p = await fetchPage(state.last);
    setState((s) => ({ ...s, rows: [...s.rows, ...p.rows], last: p.last ?? s.last, more: p.more }));
  };
  return { ...state, reload: first, loadMore };
}
