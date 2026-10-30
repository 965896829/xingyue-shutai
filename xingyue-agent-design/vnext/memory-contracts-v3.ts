export type MemoryIdV3 = string;
export type MemoryHashV3 = string;
export type ClaimKindV3 = 'world' | 'belief' | 'utterance' | 'inference' | 'plan';
export type MemoryLaneV3 = 'accepted' | 'candidate' | 'derived';
export type BeliefStanceV3 = 'knows' | 'believes' | 'suspects' | 'rejects' | 'uncertain';

export interface NarrativePointV3 {
  chapterId: MemoryIdV3;
  chapterOrder: number;
  sceneId: MemoryIdV3;
  sceneOrder: number;
  eventOrder: number;
  codePointOffset: number;
}

export interface StoryWindowV3 {
  timelineId: MemoryIdV3;
  startAnchorId: MemoryIdV3 | null;
  endAnchorId: MemoryIdV3 | null;
  precision: 'exact' | 'interval' | 'partial_order' | 'unknown';
}

export interface StoryOrderEdgeV3 {
  id: MemoryIdV3;
  fromAnchorId: MemoryIdV3;
  toAnchorId: MemoryIdV3;
  relation: 'before' | 'same_time' | 'overlaps';
  evidenceRefIds: MemoryIdV3[];
  sourceRevisionId: MemoryIdV3;
}

export interface SourceVersionV3 {
  id: MemoryIdV3;
  projectId: MemoryIdV3;
  branchId: MemoryIdV3;
  owner: 'existing_document' | 'existing_fact_document' | 'existing_author_decision';
  existingSourceId: MemoryIdV3;
  existingSnapshotId: MemoryIdV3;
  path: string;
  bodyHash: MemoryHashV3;
  revisionId: MemoryIdV3;
  recordedAt: string;
  accepted: boolean;
  sourceRole: 'original' | 'legacy_fact_document' | 'derived_projection';
}

export interface MemorySourceRefV3 {
  id: MemoryIdV3;
  sourceVersionId: MemoryIdV3;
  offsetUnit: 'unicode_codepoint';
  start: number;
  end: number;
  quote: string;
  quoteHash: MemoryHashV3;
}

export interface RevisionSelectorV3 {
  mode: 'current_canon_as_of_chapter' | 'historical_edition_as_of_revision';
  resolvedRevisionId: MemoryIdV3;
}

export interface BranchOverlayV3 {
  projectId: MemoryIdV3;
  branchId: MemoryIdV3;
  headRevisionId: MemoryIdV3;
  layers: Array<{ branchId: MemoryIdV3; throughRevisionId: MemoryIdV3; precedence: number }>;
  overlayManifestHash: MemoryHashV3;
}

export interface MemoryQueryScopeV3 {
  projectId: MemoryIdV3;
  branchId: MemoryIdV3;
  edition: RevisionSelectorV3;
  overlayManifestHash: MemoryHashV3;
  narrativeCutoff: NarrativePointV3;
  storyWindow: StoryWindowV3 | null;
  perspective: { kind: 'author' | 'reader' } | { kind: 'character'; actorId: MemoryIdV3 };
  allowedLanes: MemoryLaneV3[];
}

export type ClaimEpistemicV3 =
  | { kind: 'world' }
  | { kind: 'belief'; holderActorId: MemoryIdV3; stance: BeliefStanceV3 }
  | { kind: 'utterance'; speakerActorId: MemoryIdV3; utteredProposition: string }
  | { kind: 'inference'; producer: 'model' | 'author'; derivedFromRefIds: MemoryIdV3[] }
  | { kind: 'plan'; owner: { kind: 'author' } | { kind: 'character'; actorId: MemoryIdV3 } };

export type ClaimPublicationV3 =
  | { lane: 'accepted'; authorityBinding: { factId: MemoryIdV3; factHash: MemoryHashV3; acceptedChangeSetId: MemoryIdV3 } }
  | { lane: 'candidate'; authorityBinding: { factId: MemoryIdV3; factHash: MemoryHashV3; existingCandidateId: MemoryIdV3 } }
  | { lane: 'derived'; authorityBinding: { factId: MemoryIdV3; factHash: MemoryHashV3; derivationArtifactId: MemoryIdV3 } };

export type MemoryClaimProjectionV3 = ClaimPublicationV3 & {
  id: MemoryIdV3;
  legacyFactDocumentVersionId?: MemoryIdV3;
  projectId: MemoryIdV3;
  branchId: MemoryIdV3;
  revisionId: MemoryIdV3;
  subjectEntityId: MemoryIdV3;
  predicate: string;
  cachedValue: string;
  epistemic: ClaimEpistemicV3;
  revealedAt: NarrativePointV3;
  effectiveStoryWindow: StoryWindowV3;
  evidenceRefIds: MemoryIdV3[];
  relatedClaimIds: MemoryIdV3[];
  bindingState: 'active' | 'stale';
};

export interface KnowledgeAcquisitionV3 {
  id: MemoryIdV3;
  actorId: MemoryIdV3;
  propositionClaimId: MemoryIdV3;
  mode: 'seen' | 'heard' | 'inferred' | 'misunderstood';
  acquiredAt: NarrativePointV3;
  storyWindow: StoryWindowV3;
  evidenceRefIds: MemoryIdV3[];
  branchId: MemoryIdV3;
  revisionId: MemoryIdV3;
}

export type MemoryLifecycleEventV3 = {
  id: MemoryIdV3;
  branchId: MemoryIdV3;
  revisionId: MemoryIdV3;
  claimId: MemoryIdV3;
  authorityChangeSetId: MemoryIdV3;
  evidenceRefIds: MemoryIdV3[];
} & (
  | { kind: 'state_ended'; atStoryAnchorId: MemoryIdV3; revealedAt: NarrativePointV3; successorClaimId: MemoryIdV3 | null }
  | { kind: 'correction_retracted'; reason: string; replacementClaimId: MemoryIdV3 | null }
  | { kind: 'branch_hidden'; reason: string }
  | { kind: 'restored'; reversesEventId: MemoryIdV3 }
);

export interface PredicateDependencyV3 {
  scope: MemoryQueryScopeV3;
  entityIds: MemoryIdV3[];
  predicates: string[];
  claimKinds: ClaimKindV3[];
  normalizedFilter: string;
  queryFingerprint: MemoryHashV3;
  partitionEpochs: Record<string, number>;
  completeWithinScope: boolean;
}

export type ReadDependencyV3 =
  | { kind: 'source'; sourceVersionId: MemoryIdV3; expectedHash: MemoryHashV3 }
  | { kind: 'fact'; existingFactId: MemoryIdV3; expectedHash: MemoryHashV3 }
  | { kind: 'artifact'; artifactId: MemoryIdV3; expectedHash: MemoryHashV3 }
  | { kind: 'predicate'; query: PredicateDependencyV3; resultIds: MemoryIdV3[]; resultSetHash: MemoryHashV3 }
  | { kind: 'absence'; query: PredicateDependencyV3 & { completeWithinScope: true }; expectedEmpty: true };

export interface ReadSetV3 {
  id: MemoryIdV3;
  dependencies: ReadDependencyV3[];
  sourceSetHash: MemoryHashV3;
  predicateEpochHash: MemoryHashV3;
}

export type ProjectionCheckpointV3<T = unknown> = {
  id: MemoryIdV3;
  kind: 'character' | 'chapter' | 'relationship' | 'promise' | 'summary' | 'index' | 'retrieval_packet';
  scope: MemoryQueryScopeV3;
  payloadSchemaId: string;
  payload: T;
  readSetId: MemoryIdV3;
  throughEventSequence: number;
  inputHash: MemoryHashV3;
  compilerVersion: string;
  modelVersion: string | null;
  promptHash: MemoryHashV3 | null;
} & (
  | { state: 'ready'; outputHash: MemoryHashV3 }
  | { state: 'building' | 'stale' | 'failed'; outputHash: MemoryHashV3 | null }
);

export type CharacterFacetV3 = 'goal' | 'emotion' | 'belief' | 'relationship' | 'body_resource' | 'commitment' | 'expression_strategy';
export type CharacterReviewStatusV3 = 'changed' | 'reviewed_no_change' | 'insufficient_evidence' | 'mentioned_only' | 'unresolved_identity';
export interface ChapterMemoryCoverageV3<T = MemoryIdV3> {
  entityId?: MemoryIdV3;
  observedName: string;
  appearance: 'present' | 'recollection' | 'offscreen_affected' | 'mentioned_only' | 'unresolved';
  status: CharacterReviewStatusV3;
  evidence: T[];
  changedFacets: CharacterFacetV3[];
  unchangedFacets: CharacterFacetV3[];
  unresolvedFacets: CharacterFacetV3[];
  notApplicableFacets: CharacterFacetV3[];
  characterDeltaArtifactId?: MemoryIdV3;
  reason: string;
}

export interface ChapterMemoryBatchV3 {
  id: MemoryIdV3;
  projectId: MemoryIdV3;
  branchId: MemoryIdV3;
  revisionId: MemoryIdV3;
  chapterSourceVersionId: MemoryIdV3;
  expectedActorIds: MemoryIdV3[];
  rosterHash: MemoryHashV3;
  coverage: ChapterMemoryCoverageV3[];
  existingCandidateId: MemoryIdV3;
  existingChangeSetId: MemoryIdV3 | null;
  readSetId: MemoryIdV3;
  idempotencyKey: MemoryHashV3;
  state: 'proposed' | 'validated' | 'committed' | 'stale' | 'failed';
}

export type MemoryOutboxJobV3 = {
  id: MemoryIdV3;
  projectId: MemoryIdV3;
  branchId: MemoryIdV3;
  kind: 'extract' | 'index' | 'project' | 'invalidate' | 'consolidate';
  authorityChangeSetId: MemoryIdV3;
  expectedRevisionId: MemoryIdV3;
  idempotencyKey: MemoryHashV3;
  payloadRef: MemoryIdV3;
  attempt: number;
  payloadHash: MemoryHashV3;
  leaseUntil: string | null;
  resultArtifactId: MemoryIdV3 | null;
} & (
  | { state: 'outcome_unknown'; existingRunAttemptId: MemoryIdV3; retryDisposition: 'gateway_managed' | 'manual_review' }
  | { state: 'queued' | 'leased' | 'done' | 'failed' | 'cancelled'; existingRunAttemptId?: MemoryIdV3; retryDisposition: 'local_retry' | 'gateway_managed' | 'manual_review' }
);

export interface MemoryWatermarkV3 {
  projectId: MemoryIdV3;
  branchId: MemoryIdV3;
  pipeline: string;
  throughEventSequence: number;
  throughRevisionId: MemoryIdV3;
  pendingRequiredArtifactIds: MemoryIdV3[];
}

export interface StoryEventProposalV3 {
  proposalKey: string;
  narrativePoint: NarrativePointV3;
  storyWindow: StoryWindowV3;
  participantIds: MemoryIdV3[];
  action: string;
  outcome: string;
  evidenceRefIds: MemoryIdV3[];
  causeEventRefs: MemoryIdV3[];
}

export interface MemoryDeltaV3<TCharacterDelta> {
  schemaVersion: 3;
  projectId: MemoryIdV3;
  branchId: MemoryIdV3;
  chapterSourceVersionId: MemoryIdV3;
  basedOnRevisionId: MemoryIdV3;
  basedOnBodyHash: MemoryHashV3;
  rosterHash: MemoryHashV3;
  readSetId: MemoryIdV3;
  events: StoryEventProposalV3[];
  worldChanges: Array<{
    proposalKey: string;
    existingFactId?: MemoryIdV3;
    operation: 'add' | 'transition' | 'end' | 'correct';
    subjectEntityId: MemoryIdV3;
    predicate: string;
    value: string;
    narrativePoint: NarrativePointV3;
    storyWindow: StoryWindowV3;
    evidenceRefIds: MemoryIdV3[];
    dependsOnProposalKeys: string[];
  }>;
  characterDelta: TCharacterDelta;
  unresolved: Array<{ issue: string; evidenceRefIds: MemoryIdV3[] }>;
}

export interface RetrievalBudgetV3 {
  tokenizerId: string;
  countMode: 'exact' | 'conservative_estimate';
  contextWindowTokens: number;
  inputTokenLimit: number;
  reservedInstructionTokens: number;
  reservedRequiredEvidenceTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  optionalEvidenceTokenLimit: number;
  maxCandidates: number;
  maxGraphHops: number;
  maxGraphNodes: number;
  maxSupplementalQueries: number;
  deadlineMs: number;
}

export interface RetrievalPacketV3 {
  id: MemoryIdV3;
  scope: MemoryQueryScopeV3;
  readSetId: MemoryIdV3;
  budget: RetrievalBudgetV3;
  requiredFactIds: MemoryIdV3[];
  evidence: Array<{ claimId: MemoryIdV3; sourceRefIds: MemoryIdV3[]; tokens: number; required: boolean }>;
  characterProjectionIds: MemoryIdV3[];
  unavailableRequiredIds: MemoryIdV3[];
  countedInputTokens: number;
  readiness: 'ready' | 'pending_required_index' | 'conflict' | 'budget_exceeded';
}

export function utf16SpanToCodePointV3(text: string, start: number, end: number): { start: number; end: number } {
  const offsets = [0];
  for (const point of text) offsets.push(offsets[offsets.length - 1]! + point.length);
  const a = offsets.indexOf(start), b = offsets.indexOf(end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || a < 0 || b < a) throw new Error('Invalid UTF-16 boundary');
  return { start: a, end: b };
}

export function codePointSpanToUtf16V3(text: string, start: number, end: number): { start: number; end: number } {
  const points = Array.from(text);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > points.length) throw new Error('Invalid codepoint boundary');
  return { start: points.slice(0, start).join('').length, end: points.slice(0, end).join('').length };
}
