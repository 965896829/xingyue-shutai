import { type ProjectState, type Run, type SecretProfile } from '../../shared/types';
import type { AgentRunner } from '../runner';
import { driveTagPlanning } from '../tag-planning';
import { driveTitleNaming } from '../title-naming';

export type CreationWorkflowHost = Pick<
  AgentRunner,
  | 'store'
  | 'skillRoot'
  | 'profiles'
  | 'caller'
  | 'save'
  | 'event'
  | 'searchSettings'
  | 'search'
  | 'activity'
  | 'check'
>;

export async function driveCreationWorkflow(
  host: CreationWorkflowHost,
  r: Run,
  p: ProjectState,
  profile: SecretProfile,
  signal: AbortSignal
) {
  if (r.naming) {
    await driveTitleNaming({
      store: host.store,
      root: host.skillRoot,
      run: r,
      project: p,
      writer: profile,
      profiles: host.profiles,
      caller: host.caller,
      signal,
      save: () => host.save(r),
      event: (text) => host.event(r, 'title-phase', text),
      searchSettings: host.searchSettings(),
      search: host.search,
      onActivity: (phase) => host.activity(r, phase)
    });
    return true;
  }
  if (r.planning) {
    await driveTagPlanning({
      store: host.store,
      root: host.skillRoot,
      run: r,
      project: p,
      writer: profile,
      profiles: host.profiles,
      caller: host.caller,
      signal,
      save: () => host.save(r),
      onActivity: (phase) => host.activity(r, phase),
      event: (text) => host.event(r, 'tag-phase', text)
    });
    if (r.planning.phase === 'ready') host.check(r, p);
    return true;
  }

  return false;
}
