/** Author scope and the evidence carried across a story revision. Old projects may omit these fields. */
export interface ContinuityScope {
  mode: 'forward' | 'retcon' | 'extraction';
  fromChapter: number;
}

export interface StoryStateChange {
  factId: string;
  previousFactId?: string;
  subject: string;
  entityIds: string[];
  predicate: string;
  before: string | null;
  after: string;
  fromChapter: number;
  toChapter: number | null;
  evidence: { path: string; hash: string }[];
}

export interface StoryImpact {
  id: string;
  runId: string;
  revision: number;
  scope: ContinuityScope;
  reason: string;
  sources: { path: string; hash: string }[];
  stateChanges: StoryStateChange[];
  creationChange?: { changedClaimIds: string[]; changedConstraintIds: string[] };
  targets: { path: string; reason: string; via: string[] }[];
}
