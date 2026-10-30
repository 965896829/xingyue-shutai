import type { ClaimEpistemicV3, MemoryQueryScopeV3, NarrativePointV3, ReadSetV3, StoryWindowV3 } from './memory-contracts-v3';

export type JsonValueV5 = null | boolean | number | string | JsonValueV5[] | { [key: string]: JsonValueV5 };
export type IdV5 = string;
export type HashV5 = string;
export type DateTimeV5 = string;

export interface VersionRefV5 {
  objectId: IdV5;
  revisionId: IdV5;
  bodyHash: HashV5;
}

export interface TextSourceSpanV5 {
  sourceVersionId: IdV5;
  bodyHash: HashV5;
  coordinateUnit: 'utf16_code_unit' | 'unicode_codepoint';
  interval: 'half_open';
  start: number;
  end: number;
  quote: string;
  quoteHash: HashV5;
}

export interface PublicSourceObservationV5 {
  id: IdV5;
  canonicalUrl: string;
  publisher: string;
  sourceKind: 'official_page' | 'official_export' | 'author_supplied_snapshot' | 'public_search_result';
  observedAt: DateTimeV5;
  sourceUpdatedAt: DateTimeV5 | null;
  sourcePublishedAt: DateTimeV5 | null;
  contentHash: HashV5;
  extractorVersion: string;
  excerpt: string;
}

export type TaxonomySurfaceV5 = 'reader_library' | 'reader_ranking' | 'writer_reading_tags' | 'writer_content_tags';

export interface TaxonomyScopeV5 {
  platformId: string;
  surface: TaxonomySurfaceV5;
  channelId: string;
  workFormId: string;
  locale: string;
  normalizedFilter: string;
}

export type TaxonomyEntryIdentityV5 = TaxonomyScopeV5 & { groupId: IdV5 } & (
  | { kind: 'platform_native'; nativeId: string }
  | { kind: 'local_surrogate'; nativeId: null; stableLocalId: IdV5; labelPath: string[] }
);

export interface TaxonomyEntryV5 {
  id: IdV5;
  identity: TaxonomyEntryIdentityV5;
  label: string;
  parentEntryIds: IdV5[];
  sourceRefIds: IdV5[];
  availability: 'observed_available' | 'observed_retired' | 'unknown';
  definitionStatus: 'official_definition' | 'label_only' | 'editorial_description';
  description: string | null;
}

export type PaginationCoverageV5 =
  | { state: 'complete'; pageIds: IdV5[]; terminalEvidenceRefIds: IdV5[]; totalObserved: number; officialTotal: number | null }
  | { state: 'partial'; pageIds: IdV5[]; nextCursor: string | null; totalObserved: number; missingScopes: string[] }
  | { state: 'unknown'; pageIds: IdV5[]; reason: string };

export interface PlatformTaxonomySnapshotV5 {
  schemaVersion: 5;
  id: IdV5;
  scope: TaxonomyScopeV5;
  observedAt: DateTimeV5;
  sourceUpdatedAt: DateTimeV5 | null;
  sourceRefs: PublicSourceObservationV5[];
  entries: TaxonomyEntryV5[];
  coverage: PaginationCoverageV5;
  snapshotHash: HashV5;
  priorSnapshotId: IdV5 | null;
  changeKind: 'initial' | 'labels_changed' | 'membership_changed' | 'policy_changed' | 'unchanged';
}

export interface PublishingSelectionV5 {
  platformId: string;
  channelId: string;
  workFormId: string;
  catalogBindings: { surface: TaxonomySurfaceV5; snapshotId: IdV5; snapshotHash: HashV5 }[];
  selections: { surface: TaxonomySurfaceV5; groupId: IdV5; entryIds: IdV5[] }[];
  validation: { status: 'valid_for_observed_rules' | 'invalid_for_observed_rules' | 'unknown'; policySnapshotId: IdV5 | null; issues: string[] };
}

export interface CreativeGenreProfileV5 {
  id: IdV5;
  revisionId: IdV5;
  genres: { id: IdV5; label: string; role: 'primary' | 'supporting' | 'blend'; origin: 'author' | 'inferred' | 'proposed'; evidenceRefIds: IdV5[] }[];
  settingFrames: string[];
  narrativeEngines: string[];
  readerPromises: string[];
  forbiddenElements: string[];
  authorIntentSourceRefs: TextSourceSpanV5[];
  publishingSelection: PublishingSelectionV5 | null;
}

export const worldModuleIdsV5 = ['world-foundation', 'geography-mobility', 'history-calendar', 'society-factions', 'economy-resources', 'ability-rules', 'progression', 'technology-profession', 'investigation-evidence', 'relationship-norms', 'species-ecology', 'system-interface'] as const;
export type WorldModuleIdV5 = typeof worldModuleIdsV5[number] | `custom:${string}`;

export interface AuthorFieldLockV5 {
  id: IdV5;
  targetObjectId: IdV5;
  jsonPointer: string;
  expectedValueHash: HashV5;
  source: TextSourceSpanV5;
  state: 'locked' | 'released';
  authorDecisionId: IdV5;
  releasedByDecisionId: IdV5 | null;
}

export interface WorldModuleSelectionV5 {
  moduleId: WorldModuleIdV5;
  state: 'enabled' | 'disabled' | 'undecided';
  origin: 'author' | 'inferred' | 'proposed';
  reason: string;
  evidenceRefIds: IdV5[];
  fieldLocks: AuthorFieldLockV5[];
  dependsOnModuleIds: WorldModuleIdV5[];
  objectVersionRefs: VersionRefV5[];
}

export interface AuthorValueNormalizationV5<T extends JsonValueV5 = JsonValueV5> {
  originalText: string;
  originalSourceRefs: TextSourceSpanV5[];
  normalizedValue: T;
  normalizationState: 'verbatim_equivalent' | 'interpretation_candidate' | 'author_confirmed' | 'unresolved';
  unresolvedQuestions: string[];
  confirmedByDecisionId: IdV5 | null;
}

export type ObjectAuthorityV5 =
  | { lane: 'candidate'; candidateId: IdV5; taskId: IdV5 }
  | { lane: 'canon'; acceptedChangeSetId: IdV5; revisionId: IdV5 }
  | { lane: 'derived'; derivationId: IdV5; sourceVersionRefs: VersionRefV5[] };

export interface WorldRuleV5 {
  id: IdV5;
  version: VersionRefV5;
  projectId: IdV5;
  branchId: IdV5;
  moduleId: WorldModuleIdV5;
  name: AuthorValueNormalizationV5<string>;
  statement: AuthorValueNormalizationV5<string>;
  triggers: string[];
  preconditions: string[];
  effects: string[];
  costs: string[];
  countermeasures: string[];
  exceptions: { id: IdV5; condition: string; result: string; evidenceRefIds: IdV5[] }[];
  relatedEntityIds: IdV5[];
  scope: MemoryQueryScopeV3;
  effectiveStoryWindow: StoryWindowV3;
  epistemic: ClaimEpistemicV3;
  revelation: { readerAt: NarrativePointV3 | null; acquisitionEventIds: IdV5[]; plannedRevealObjectId: IdV5 | null };
  authority: ObjectAuthorityV5;
  sourceRefs: TextSourceSpanV5[];
  fieldLocks: AuthorFieldLockV5[];
}

export interface ProgressionNodeV5 {
  id: IdV5;
  name: AuthorValueNormalizationV5<string>;
  capabilities: string[];
  limitations: string[];
  qualifications: string[];
  socialEntitlementIds: IdV5[];
  sourceRefIds: IdV5[];
}

export interface ProgressionTransitionV5 {
  id: IdV5;
  fromNodeIds: IdV5[];
  toNodeIds: IdV5[];
  preconditions: string[];
  resourceCosts: { resourceId: IdV5; quantity: number | null; unit: string | null; qualitativeRequirement: string | null }[];
  irreversibleEffects: string[];
  reversibility: 'reversible' | 'conditional' | 'irreversible' | 'unknown';
  counterRuleIds: IdV5[];
  evidenceRefIds: IdV5[];
}

export type ProgressionModelV5 =
  | { kind: 'none'; reason: string; authorDecisionId: IdV5 | null }
  | { kind: 'linear'; nodes: ProgressionNodeV5[]; orderedNodeIds: IdV5[]; transitions: ProgressionTransitionV5[] }
  | { kind: 'branching'; nodes: ProgressionNodeV5[]; entryNodeIds: IdV5[]; transitions: ProgressionTransitionV5[]; declaredCycleIds: IdV5[][] }
  | { kind: 'multi_axis'; axes: { id: IdV5; name: string; nodes: ProgressionNodeV5[] }[]; transitions: ProgressionTransitionV5[]; crossAxisConstraints: string[] }
  | { kind: 'custom'; schemaId: IdV5; schemaHash: HashV5; value: JsonValueV5; validatorId: IdV5 | null };

export type ProgressionSubjectSelectorV5 =
  | { kind: 'all_entities' }
  | { kind: 'entities'; entityIds: [IdV5, ...IdV5[]] }
  | { kind: 'faction_members'; factionIds: [IdV5, ...IdV5[]]; membershipAt: 'queried_story_time' }
  | { kind: 'any_of' | 'all_of'; selectors: [ProgressionSubjectSelectorV5, ...ProgressionSubjectSelectorV5[]] }
  | { kind: 'not'; selector: ProgressionSubjectSelectorV5 };

export interface ProgressionApplicabilityV5 {
  subjects: ProgressionSubjectSelectorV5;
  conditions: { id: IdV5; statement: AuthorValueNormalizationV5<string>; ruleVersionRefs: VersionRefV5[]; resolution: 'specified' | 'unresolved' }[];
  conditionCombination: 'all_required';
  evaluation: 'host_supported' | 'author_judgment_required' | 'unresolved';
}

export interface ProgressionSystemV5 {
  id: IdV5;
  version: VersionRefV5;
  projectId: IdV5;
  branchId: IdV5;
  name: AuthorValueNormalizationV5<string>;
  definition: AuthorValueNormalizationV5<string>;
  origin: 'author' | 'inferred' | 'proposed';
  queryScope: MemoryQueryScopeV3;
  effectiveStoryWindow: StoryWindowV3;
  applicability: ProgressionApplicabilityV5;
  model: ProgressionModelV5;
  crossSystemRuleIds: IdV5[];
  sourceRefs: TextSourceSpanV5[];
  fieldLocks: AuthorFieldLockV5[];
  authority: ObjectAuthorityV5;
}

export interface WorldModelV5 {
  schemaVersion: 5;
  id: IdV5;
  projectId: IdV5;
  branchId: IdV5;
  version: VersionRefV5;
  creativeProfile: VersionRefV5;
  modules: WorldModuleSelectionV5[];
  rules: WorldRuleV5[];
  progressionSystems: ProgressionSystemV5[];
  customModuleSchemas: { moduleId: `custom:${string}`; schemaId: IdV5; schemaHash: HashV5; validatorId: IdV5 | null }[];
  readSet: ReadSetV3;
  authority: ObjectAuthorityV5;
}

export type TitleEvidenceLevelV5 = 'official_ranking_observation' | 'official_book_metadata' | 'public_search_hit' | 'editorial_inference' | 'author_experiment_observation';

export interface RankingObservationV5 {
  boardId: string;
  boardLabel: string;
  rank: number;
  channelId: string;
  genreIdentity: TaxonomyEntryIdentityV5 | null;
  boardUpdatedAt: DateTimeV5 | null;
  observedAt: DateTimeV5;
  window: { startAt: DateTimeV5 | null; endAt: DateTimeV5 | null; label: string };
  sourceRefIds: IdV5[];
}

export interface TitleEvidenceClaimV5 {
  id: IdV5;
  level: TitleEvidenceLevelV5;
  statement: string;
  sourceRefIds: IdV5[];
  scopeLimitations: string[];
}

export interface TitleMarketSampleV5 {
  sampleId: IdV5;
  platformId: string;
  bookId: string | null;
  canonicalBookUrl: string;
  observedTitle: string;
  observedAt: DateTimeV5;
  sourceUpdatedAt: DateTimeV5 | null;
  bookPublishedAt: DateTimeV5 | null;
  channelId: string | null;
  genres: { identity: TaxonomyEntryIdentityV5; label: string; sourceRefIds: IdV5[] }[];
  serialStatus: 'serializing' | 'completed' | 'unknown';
  ranking: RankingObservationV5 | null;
  metrics: { name: string; value: number | null; unit: string; definition: string | null; observedAt: DateTimeV5; sourceRefIds: IdV5[] }[];
  claims: TitleEvidenceClaimV5[];
  sourceRefIds: IdV5[];
}

export interface TitleSampleSelectionV5 {
  sampleId: IdV5;
  requestedScope: TaxonomyScopeV5;
  matchKind: 'exact' | 'adjacent' | 'cross_channel' | 'unmapped';
  basis: { explanation: string; sourceRefIds: IdV5[]; evidenceClaimIds: IdV5[] };
  editorialUse: { status: 'include' | 'partial_reference' | 'exclude' | 'unreviewed'; reason: string; derivedClaimIds: IdV5[] };
}

export interface TitleEvidenceSnapshotV5 {
  id: IdV5;
  hash: HashV5;
  publicQueries: string[];
  scope: TaxonomyScopeV5;
  observedAt: DateTimeV5;
  sourceUpdatedAt: DateTimeV5 | null;
  sources: PublicSourceObservationV5[];
  samples: TitleMarketSampleV5[];
  sampleSelections: TitleSampleSelectionV5[];
  coverage: PaginationCoverageV5;
  state: 'ready' | 'partial' | 'stale' | 'unavailable' | 'disabled';
  selectionMethod: string;
  comparableMetricKeys: string[];
  styleBrief: { text: string; evidenceClaimIds: IdV5[]; modelBindingId: IdV5 } | null;
  taskBindingId: IdV5;
}

export interface PackagingStoryContextV5 {
  authorContractVersion: VersionRefV5;
  availableWorldVersion: VersionRefV5 | null;
  openingPlanVersion: VersionRefV5 | null;
  openingProseVersion: VersionRefV5 | null;
  confirmedClaimVersionRefs: VersionRefV5[];
  knownGaps: { field: 'world' | 'opening_plan' | 'opening_prose' | 'confirmed_claims'; reason: string; requestedClarification: string | null }[];
}

export interface PublicationPromiseCarrierV5 {
  kind: 'book_title' | 'blurb' | 'story_plan' | 'prose';
  artifactVersion: VersionRefV5;
}

export type PublicationPromiseSupportV5 =
  | { kind: 'confirmed_setting'; claimVersionRefs: [VersionRefV5, ...VersionRefV5[]]; sourceRefs: TextSourceSpanV5[] }
  | { kind: 'plan'; artifactVersion: VersionRefV5; sourceRefs: TextSourceSpanV5[] }
  | { kind: 'prose'; artifactVersion: VersionRefV5; sourceRefs: [TextSourceSpanV5, ...TextSourceSpanV5[]] }
  | { kind: 'proposal'; candidateId: IdV5; artifactVersion: VersionRefV5; sourceRefs: TextSourceSpanV5[] };

export interface PublicationPromiseV5 {
  id: IdV5;
  carrier: PublicationPromiseCarrierV5;
  promiseText: string;
  authorContractVersion: VersionRefV5;
  worldVersion: VersionRefV5 | null;
  supportBasis: [PublicationPromiseSupportV5, ...PublicationPromiseSupportV5[]];
  openingPlanVersion: VersionRefV5 | null;
  openingProseVersion: VersionRefV5 | null;
  payoff: { stage: 'opening' | 'volume' | 'long_term' | 'ongoing'; targetSceneIds: IdV5[]; evidenceRefIds: IdV5[]; state: 'planned' | 'observed' | 'unverified' };
  marketEvidenceSnapshotId: IdV5 | null;
  readSet: ReadSetV3;
  state: 'candidate' | 'accepted' | 'needs_revalidation';
}

export type ProjectionStreamPositionV5 =
  | { kind: 'scope_sequence'; sequenceDomainId: IdV5; scopeHash: HashV5; sequence: number; previousSequence: number | null }
  | { kind: 'opaque_cursor'; cursorDomainId: IdV5; scopeHash: HashV5; cursor: string; previousCursor: string | null };

export type ProjectionWatermarkV5 = {
  requiredScopeHash: HashV5;
  state: 'ready' | 'building' | 'stale' | 'failed';
} & (
  | { kind: 'scope_sequence'; sequenceDomainId: IdV5; contiguousThroughSequence: number; targetSequence: number }
  | { kind: 'opaque_cursor'; cursorDomainId: IdV5; completedThroughCursor: string | null; targetCursor: string | null }
);

export interface ProjectionHeaderV5 {
  schemaVersion: 5;
  eventId: IdV5;
  projectionId: IdV5;
  projectId: IdV5;
  branchId: IdV5;
  scope: MemoryQueryScopeV3;
  scopeHash: HashV5;
  objectVersionRefs: VersionRefV5[];
  streamPosition: ProjectionStreamPositionV5;
  sourceCommitSequence: number | null;
  workerGeneration: number;
  transportEpoch: string;
  emittedAt: DateTimeV5;
  sourceRefs: TextSourceSpanV5[];
  watermark: ProjectionWatermarkV5;
  readSetDigest: HashV5;
}

export type ProjectionEnvelopeV5<T extends JsonValueV5 = JsonValueV5> = ProjectionHeaderV5 & (
  | { lane: 'canon'; revisionId: IdV5; commitReceiptId: IdV5; payload: T }
  | { lane: 'draft'; baseRevisionId: IdV5; candidateId: IdV5; candidateVersion: number; candidateHash: HashV5; payload: T }
  | { lane: 'streaming'; baseRevisionId: IdV5; taskId: IdV5; draftEpoch: string; draftVersion: number; visiblePrefixHash: HashV5; visibleThrough: { coordinateUnit: 'utf16_code_unit' | 'unicode_codepoint'; offset: number }; retractsEventIds: IdV5[]; payload: T }
);

export interface SemanticChangePreconditionsV5 {
  expectedHeadRevisionId: IdV5;
  expectedObjectVersions: VersionRefV5[];
  expectedLockVersions: { lockId: IdV5; expectedValueHash: HashV5 }[];
  explicitConstraintChangeDecisionIds: IdV5[];
  authorizationBindingId: IdV5;
  scope: MemoryQueryScopeV3;
  readSet: ReadSetV3;
  readSetDigest: HashV5;
}

export interface WorldImpactScanV5 {
  scope: MemoryQueryScopeV3;
  rootObjectIds: IdV5[];
  dependencyKinds: ('source' | 'fact' | 'artifact' | 'predicate' | 'absence')[];
  normalizedFilter: string;
  coverage: 'complete_for_scope' | 'partial' | 'unknown';
  dependencyScanVersion: string;
  readSetDigest: HashV5;
  verifiedImpactObjectIds: IdV5[];
  unresolvedFrontierIds: IdV5[];
  limitationReasons: string[];
}

export interface WorldSemanticChangeSetV5 {
  id: IdV5;
  projectId: IdV5;
  branchId: IdV5;
  proposalHash: HashV5;
  preconditions: SemanticChangePreconditionsV5;
  changes: { id: IdV5; groupId: IdV5; objectId: IdV5; jsonPointer: string; beforeValueHash: HashV5; afterValue: JsonValueV5; semantics: 'future_change' | 'correction' | 'retcon'; evidenceRefIds: IdV5[] }[];
  groups: { id: IdV5; changeIds: IdV5[]; requiresGroupIds: IdV5[] }[];
  hostImpactScan: WorldImpactScanV5;
}

export type VisualCommandV5 =
  | { kind: 'layout_change'; commandId: IdV5; projectId: IdV5; branchId: IdV5; viewId: IdV5; expectedLayoutVersion: number; positions: { nodeId: IdV5; x: number; y: number; pinned: boolean }[]; viewport: { x: number; y: number; zoom: number } }
  | { kind: 'semantic_change_proposal'; commandId: IdV5; changeSet: WorldSemanticChangeSetV5 }
  | { kind: 'semantic_change_apply'; commandId: IdV5; projectId: IdV5; branchId: IdV5; changeSetId: IdV5; proposalHash: HashV5; selectedGroupIds: IdV5[]; preconditions: SemanticChangePreconditionsV5 }
  | { kind: 'query_view'; commandId: IdV5; projectId: IdV5; branchId: IdV5; viewId: IdV5; scope: MemoryQueryScopeV3; focusObjectIds: IdV5[]; depth: number; edgeTypes: string[]; cursor: string | null };

export type VisualCommandReceiptV5 =
  | { kind: 'layout_saved'; commandId: IdV5; layoutVersion: number }
  | { kind: 'candidate_ready'; commandId: IdV5; changeSetId: IdV5; proposalHash: HashV5 }
  | { kind: 'semantic_applied'; commandId: IdV5; changeSetId: IdV5; revisionId: IdV5; commitReceiptId: IdV5 }
  | { kind: 'stale' | 'blocked'; commandId: IdV5; reasonCodes: string[]; affectedObjectIds: IdV5[] };
