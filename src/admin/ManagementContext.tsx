import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { invokeCommand } from '../shared/client';
import type { Snapshot } from '../shared/types';
import type { ManagementStatus } from '../shared/management';
import type { ManagementSession, ManagementTransport } from './transport';

type State = { snapshot?: Snapshot; client: ManagementStatus; transport: ManagementTransport; refresh(): Promise<void>; connected: boolean; expired: boolean; error: string };
const Context = createContext<State>(null!);
export const useManagement = () => useContext(Context);
export function ManagementProvider({ session, transport, children }: { session: ManagementSession; transport: ManagementTransport; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(), [client, setClient] = useState(session.client);
  const [connected, setConnected] = useState(true), [expired, setExpired] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const [s, c] = await Promise.all([invokeCommand('app.snapshot'), transport.api<ManagementStatus>('status')]);
      if (seq !== sequence.current) return;
      setSnapshot(s); setClient(c); setError('');
    } catch (e) { if (seq === sequence.current) setError((e as Error).message); }
  }, [transport]);
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = window.wenxu!.onEvent(event => {
      if (['delta', 'prose-delta'].includes(event.type) || timer) return;
      timer = setTimeout(() => { timer = undefined; void refresh(); }, 450);
    });
    const lost = () => setConnected(false), restored = () => { setConnected(true); void refresh(); }, invalid = () => { setExpired(true); setConnected(false); };
    window.addEventListener('management:disconnected', lost); window.addEventListener('management:connected', restored); window.addEventListener('management:expired', invalid); window.addEventListener('management:refresh', refresh);
    return () => { unsub(); clearTimeout(timer); window.removeEventListener('management:disconnected', lost); window.removeEventListener('management:connected', restored); window.removeEventListener('management:expired', invalid); window.removeEventListener('management:refresh', refresh); };
  }, [refresh]);
  return <Context.Provider value={{ snapshot, client, transport, refresh, connected, expired, error }}>{children}</Context.Provider>;
}
