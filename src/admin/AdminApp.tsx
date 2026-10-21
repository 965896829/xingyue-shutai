import { AdminApp as ReferenceAdminApp } from './reference/components/admin-app';
import { ColorModeProvider } from './reference/components/color-mode';
import { ManagementProvider } from './ManagementContext';
import type { ManagementSession, ManagementTransport } from './transport';
export function AdminApp({ session, transport }: { session: ManagementSession; transport: ManagementTransport }) {
  return <ManagementProvider session={session} transport={transport}><ColorModeProvider><ReferenceAdminApp /></ColorModeProvider></ManagementProvider>;
}
