import { App } from '../ui/App';
import { AssistantSettings } from '../ui/AssistantSettings';
import type { Snapshot } from '../shared/types';
import { localViews } from './client-views';
import styles from '../ui/styles.css?inline';
import studio from '../ui/studio.css?inline';
import assistant from '../ui/assistant.css?inline';
import tags from '../ui/tags.css?inline';
import recovery from '../ui/recovery.css?inline';
import controls from '../ui/interaction-controls.css?inline';
import brand from '../ui/brand.css?inline';
import desktopLayout from '../ui/desktop-layout.css?inline';
import { navigate, useRoute } from './reference/router';

// Scope the existing business modules' styles; the original admin owns the page shell.
const css = `@scope (.client-module) { ${[styles, studio, assistant, tags, recovery, controls, brand, desktopLayout].join('\n')} }`;
export function ClientModule({ active, pageKey, snapshot }: { active: boolean; pageKey: string; snapshot?: Snapshot }) {
  const view = localViews[pageKey];
  const route = useRoute();
  const query = new URLSearchParams(view === 'workspace' ? route.split('?')[1] : '');
  const action = query.get('action');
  const target = action === 'new' || action === 'models' ? action : view;
  return <div className="client-module" hidden={!view}>
    <style>{css}</style>
    <div hidden={view === 'assistant'}><App management managementActive={active && view !== 'assistant'} managementView={target && target !== 'assistant' ? target : 'workspace'}
      managementDocument={query.get('document')} managementSession={query.get('session')} /></div>
    {view === 'assistant' && snapshot && <AssistantSettings initialSection="search" profiles={snapshot.profiles} onClose={() => navigate('/admin/agentmanage')} />}
  </div>;
}
