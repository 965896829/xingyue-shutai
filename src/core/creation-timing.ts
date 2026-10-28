import type { CreationTiming } from '../shared/creation-progress';
import type { Profile, ProjectState, Run } from '../shared/types';
import { withTaskReasoning } from '../shared/reasoning';
import { hash } from './domain';

interface TimingStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}
interface Sample { id: string; key: string; seconds: number; at: number }
interface Measurement {
  id: string;
  key: string;
  start: number;
  kind: 'directions' | 'plan' | 'titles';
  formatRepairs: number;
  semanticRevisions: number;
  eligible: boolean;
  view: CreationTiming;
}
const storageKey = 'creationTiming:v1';
const retention = 30 * 24 * 60 * 60 * 1000;

function samples(store: TimingStore, at: number): Sample[] {
  const values = store.get<unknown>(storageKey);
  return (Array.isArray(values) ? values : []).filter((value): value is Sample =>
    value && typeof value.id === 'string' && typeof value.key === 'string' &&
    Number.isFinite(value.seconds) && value.seconds >= 1 && value.seconds <= 21600 &&
    Number.isFinite(value.at) && value.at <= at && value.at > at - retention
  ).slice(-500);
}

function profileKey(profile: Profile, run: Run) {
  const effective = withTaskReasoning(profile, run);
  // No API keys, prompts, manuscript content, or project paths enter the history.
  return { model: effective.model, protocol: effective.protocol, endpoint: effective.baseUrl,
    proxy: effective.proxy, effort: effective.reasoningEffort ?? null, outputLimit: effective.outputLimit };
}

/** Records uninterrupted phase execution, excluding time waiting for the author. */
export class CreationTimings {
  private active = new Map<string, Measurement>();

  begin(run: Run, project: ProjectState, profiles: Profile[], store: TimingStore, at = Date.now()) {
    this.active.delete(run.id);
    const planning = run.planning, naming = run.naming, task = planning ?? naming;
    if (!task) return;
    const kind = naming ? 'titles' : planning && ['contract', 'reviewing_contract', 'ready'].includes(planning.phase) ? 'plan' : 'directions';
    if (['ready', 'awaiting_direction'].includes(task.phase)) return;
    const writer = profiles.find(profile => profile.id === run.profileId);
    const reviewer = kind === 'directions' ? undefined : profiles.find(profile => profile.id === (project.config.modelRouting.review || run.profileId));
    if (!writer || kind !== 'directions' && !reviewer) return;
    const failedReview = naming ? naming.review?.result.decisions.every(decision => decision.verdict !== 'keep')
      : kind === 'plan' && planning?.contractReview?.result.issues.some(issue => issue.severity !== 'minor');
    const legacyDirectionRepair = kind === 'directions' && planning?.repair?.phase === 'planning';
    const eligible = ['planning', 'contract', 'generating'].includes(task.phase) && !run.messages.length && !failedReview && !legacyDirectionRepair;
    const scope = naming ? (naming.manualTitle ? 'manual' : naming.regenerate ? 'single' : `batch:${naming.candidateCount ?? 'legacy'}`)
      : kind === 'directions' ? (planning?.regenerate ? `replace:${planning.regenerate.keepDirectionIds ? 3 - planning.regenerate.keepDirectionIds.length : 1}` : 'initial') : 'plan';
    // Single-pass directions must not inherit old generation + review estimates.
    const key = hash(JSON.stringify({ version: kind === 'directions' ? 2 : 1, kind, scope, workflow: planning?.workflowVersion,
      origin: planning?.origin, rule: naming?.rule, writer: profileKey(writer, run), reviewer: reviewer ? profileKey(reviewer, run) : undefined }));
    const recent = samples(store, at).filter(value => value.key === key).slice(-20).map(value => value.seconds).sort((a, b) => a - b);
    const view: CreationTiming = { startedAt: new Date(at).toISOString(), samples: recent.length,
      unavailable: eligible ? 'history' : 'resumed' };
    if (eligible && recent.length >= 3) {
      // A deliberately coarse recent range, not a confidence interval or a deadline.
      view.expectedSeconds = { low: Math.max(1, Math.floor(recent[Math.floor((recent.length - 1) * 0.1)] * 0.85)),
        high: Math.ceil(recent[Math.ceil((recent.length - 1) * 0.9)] * 1.15) };
      delete view.unavailable;
    }
    this.active.set(run.id, { id: hash(`${run.id}:${at}`), key, kind, start: at, eligible, view,
      formatRepairs: task.formatRepairs, semanticRevisions: task.semanticRevisions });
  }

  view(run: Run): CreationTiming | undefined {
    const measurement = this.active.get(run.id), task = run.planning ?? run.naming;
    if (!measurement || !task || run.status !== 'running') return;
    if (task.formatRepairs !== measurement.formatRepairs || task.semanticRevisions !== measurement.semanticRevisions)
      return { startedAt: measurement.view.startedAt, samples: measurement.view.samples, unavailable: 'repair' };
    return measurement.view;
  }

  finish(run: Run, store: TimingStore, at = Date.now()) {
    const measurement = this.active.get(run.id);
    this.active.delete(run.id);
    const task = run.planning ?? run.naming;
    if (!measurement?.eligible || !task || run.error || run.accepted) return;
    const success = measurement.kind === 'directions'
      ? run.planning?.phase === 'awaiting_direction' && run.status === 'awaiting_input'
      : task.phase === 'ready' && run.status === 'awaiting_review';
    const seconds = (at - measurement.start) / 1000;
    if (!success || task.formatRepairs !== measurement.formatRepairs || task.semanticRevisions !== measurement.semanticRevisions ||
      !Number.isFinite(seconds) || seconds < 1 || seconds > 21600) return;
    const recent = samples(store, at).filter(value => value.id !== measurement.id);
    store.set(storageKey, [...recent, { id: measurement.id, key: measurement.key, seconds, at }].slice(-500));
  }
}
