import { useRef, useState } from 'react';

/** Keep action failures visible when refreshing the workspace also fails. */
export function useWorkspaceAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false);
  const act = async (fn: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      try {
        await refresh();
      } catch (e) {
        setError((previous) => previous || (e as Error).message);
      }
      setBusy(false);
      pending.current = false;
    }
  };
  return { busy, error, act };
}
