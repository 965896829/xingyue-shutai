import { App } from '../ui/App';
import { AssistantSettings } from '../ui/AssistantSettings';
import type { Snapshot } from '../shared/types';
import type { ManagementView } from '../shared/management';
import styles from '../ui/styles.css?inline';
import studio from '../ui/studio.css?inline';
import assistant from '../ui/assistant.css?inline';
import tags from '../ui/tags.css?inline';
import recovery from '../ui/recovery.css?inline';
import controls from '../ui/interaction-controls.css?inline';
import brand from '../ui/brand.css?inline';
import { navigate } from './reference/router';

export const localViews: Record<string, ManagementView | 'assistant'> = {
  'local-workspace': 'workspace', 'local-creation': 'creation', workflows: 'tasks',
  memory: 'memory', 'structured-content': 'memory', 'local-cover': 'cover',
  'local-settings': 'project', backups: 'transfer', storage: 'transfer',
  'local-trash': 'trash', 'local-search': 'assistant'
};
// Scope the existing business modules' styles; the original admin owns the page shell.
const css = `@scope (.client-module) { ${[styles, studio, assistant, tags, recovery, controls, brand].join('\n')} }`;
export function ClientModule({ pageKey, snapshot }: { pageKey: string; snapshot?: Snapshot }) {
  const view = localViews[pageKey];
  return <div className="client-module" hidden={!view}>
    <style>{css}</style>
    <div hidden={view === 'assistant'}><App management managementView={view && view !== 'assistant' ? view : 'workspace'} /></div>
    {view === 'assistant' && snapshot && <AssistantSettings initialSection="search" profiles={snapshot.profiles} onClose={() => navigate('/admin/agentmanage')} />}
  </div>;
}
