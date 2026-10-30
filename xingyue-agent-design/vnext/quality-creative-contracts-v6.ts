import type { MemoryQueryScopeV3, NarrativePointV3, ReadSetV3, StoryWindowV3 } from './memory-contracts-v3';
import type { AuthorFieldLockV5, HashV5, IdV5, JsonValueV5, ProjectionWatermarkV5, TextSourceSpanV5, VersionRefV5 } from './world-contracts-v5';

export type IdV6 = IdV5;
export type HashV6 = HashV5;
export type NonEmptyV6<T> = [T, ...T[]];
export type RuntimeCoreVariantV6 = 'author' | 'reader_prefix' | 'character_turn';

export type WorkBaseV6 =
  | { kind: 'existing_work'; projectId: IdV6; branchId: IdV6; headRevisionId: IdV6; snapshotId: IdV6; snapshotHash: HashV6; scope: MemoryQueryScopeV3; readSet: ReadSetV3 }
  | { kind: 'initial_work'; projectId: IdV6; branchId: IdV6; creationSnapshotId: IdV6; creationSnapshotHash: HashV6; inputVersions: NonEmptyV6<VersionRefV5>; acceptedProse: false; narrativeScope: null; readSet: ReadSetV3 };

export type CreativePositionV6 =
  | { kind: 'placed'; narrativePoint: NarrativePointV3; storyWindow: StoryWindowV3 | null }
  | { kind: 'provisional'; localSceneId: IdV6; proposedStoryWindow: StoryWindowV3 | null };

export interface CreativeBudgetV6 {
  policyId: IdV6;
  maximumModelRequests: number;
  inputTokenLimit: number;
  outputTokenLimit: number;
  totalTokenLimit: number | null;
  costLimit: { currency: string; amount: number } | null;
  durationLimitMs: number;
  stopAfter: 'one_submission' | 'one_actor_turn' | 'requested_scene_boundary';
  repairRequestsIncluded: true;
}

export type ConstraintTargetV6 =
  | { kind: 'existing_field'; objectVersion: VersionRefV5; jsonPointer: string }
  | { kind: 'new_object_scope'; objectKinds: NonEmptyV6<string>; scopeDescription: string }
  | { kind: 'task_text'; field: 'prose' | 'dialogue' | 'outcome' | 'tone'; scopeDescription: string };

export interface CreativeConstraintV6 {
  id: IdV6;
  target: ConstraintTargetV6;
  text: string;
  sourceRefs: NonEmptyV6<TextSourceSpanV5>;
  authorDecisionId: IdV6;
}

export interface ExplorationAllowanceV6 {
  id: IdV6;
  target: ConstraintTargetV6;
  allowedChanges: NonEmptyV6<'ordinary_detail' | 'new_supporting_character' | 'strategy' | 'relationship_development' | 'world_interpretation' | 'new_world_rule' | 'event' | 'outcome'>;
  conditions: string[];
  protectedConstraintIds: IdV6[];
  sourceRefs: NonEmptyV6<TextSourceSpanV5>;
}

export interface CreativeTaskPolicyV6 {
  schemaVersion: 6;
  id: IdV6;
  version: VersionRefV5;
  authorPrincipalId: IdV6;
  authorContractVersion: VersionRefV5;
  base: WorkBaseV6;
  mode: 'planned' | 'exploration' | 'local_cocreation';
  hardLocks: CreativeConstraintV6[];
  inheritedFieldLocks: AuthorFieldLockV5[];
  preferences: CreativeConstraintV6[];
  explorable: ExplorationAllowanceV6[];
  explicitLockChangeDecisionIds: IdV6[];
  candidateApplyAuthorizationId: IdV6 | null;
  ordinaryDetails: 'allowed_within_scope' | 'propose_only';
  unknownHandling: 'preserve_unknown' | 'propose_within_allowances';
  budget: CreativeBudgetV6;
}

export interface ReadingTargetCardV6 {
  schemaVersion: 6;
  version: VersionRefV5;
  projectId: IdV6;
  audienceDescription: string;
  distinctivePremise: string;
  intendedRewards: string[];
  openingPromise: string;
  expressionPriorities: string[];
  authorTradeoffs: string[];
  authorProtectedFeatures: CreativeConstraintV6[];
  origin: 'author_defined' | 'model_proposal' | 'author_accepted';
  sourceRefs: TextSourceSpanV5[];
  authorDecisionId: IdV6 | null;
  evidenceMeaning: 'creative_intent_only';
}

export interface CandidateAdditionV6 {
  id: IdV6;
  localObjectId: IdV6 | null;
  kind: 'new_character' | 'world_rule' | 'relationship' | 'event' | 'motivation' | 'interpretation' | 'other';
  statement: string;
  allowanceId: IdV6;
  changesExistingPremise: boolean;
  relatedIntentChangeIds: IdV6[];
  target: ConstraintTargetV6 | null;
  sourceSpans: TextSourceSpanV5[];
  dependentAdditionIds: IdV6[];
  requiredForScene: boolean;
}

export interface ExplorationDraftV6 {
  schemaVersion: 6;
  id: IdV6;
  projectId: IdV6;
  branchId: IdV6;
  taskId: IdV6;
  base: WorkBaseV6;
  policyVersion: VersionRefV5;
  position: CreativePositionV6;
  candidateVersion: VersionRefV5;
  prose: string;
  additions: CandidateAdditionV6[];
  intentChanges: IntentChangeProposalV6[];
  unresolved: { id: IdV6; issue: string; blocksPromotion: boolean; relatedAdditionIds: IdV6[] }[];
  protectedFeatureIds: IdV6[];
  sourceReadSet: ReadSetV3;
  status: 'candidate' | 'stale' | 'discarded';
  authority: 'exploration_only';
}

export interface ExplorationBranchV6 {
  schemaVersion: 6;
  id: IdV6;
  projectId: IdV6;
  base: WorkBaseV6;
  parentExperimentBranchId: IdV6 | null;
  headCandidateVersion: VersionRefV5 | null;
  policyVersion: VersionRefV5;
  position: CreativePositionV6;
  siblingBranchIds: IdV6[];
  localIdentityNamespace: string;
  state: 'open' | 'stale' | 'closed';
  authorChosenCandidateId: IdV6 | null;
  canonicalMemoryWriteAllowed: false;
}

export interface CandidatePromotionRequestV6 {
  id: IdV6;
  projectId: IdV6;
  sourceExperimentBranchId: IdV6;
  selectedCandidateVersion: VersionRefV5;
  selectedAdditionIds: IdV6[];
  selectedIntentChangeIds: IdV6[];
  targetBase: WorkBaseV6;
  expectedPolicyVersion: VersionRefV5;
  authorDecisionId: IdV6;
  requestedEffect: 'prepare_changeset_candidate';
  identityMapping: { localId: IdV6; destination: { kind: 'existing'; entityId: IdV6 } | { kind: 'allocate_new'; objectKind: string } }[];
  readSet: ReadSetV3;
}

export interface CandidatePromotionReceiptV6 {
  requestId: IdV6;
  state: 'candidate_prepared' | 'needs_revalidation' | 'blocked';
  preparedChangeSetId: IdV6 | null;
  validatedSourceVersion: VersionRefV5;
  validatedTargetBaseHash: HashV6;
  reasons: string[];
  canonicalStateChanged: false;
  requiredNextChecks: ('dependency_closure' | 'author_constraints' | 'identity_resolution' | 'prose_memory_same_version' | 'source_reextraction')[];
}

export interface ModelVisibleSourceBaseV6 {
  alias: string;
  text: string;
  contentHash: HashV6;
}

export type ReaderVisibleSourceV6 = ModelVisibleSourceBaseV6 & {
  kind: 'prose' | 'visible_heading' | 'presented_title' | 'presented_blurb';
};

export type CharacterVisibleSourceV6 = ModelVisibleSourceBaseV6 & {
  kind: 'actor_observation' | 'actor_belief' | 'actor_expression';
};

export type ModelVisibleSourceV6 = ReaderVisibleSourceV6 | CharacterVisibleSourceV6;

export interface ModelVisibleCitationV6 {
  sourceAlias: string;
  coordinateUnit: 'unicode_codepoint';
  interval: 'half_open';
  start: number;
  end: number;
  quote: string;
}

export interface ReaderPrefixPayloadV6 {
  kind: 'reader_prefix';
  requestAlias: string;
  sources: NonEmptyV6<ReaderVisibleSourceV6>;
  task: 'first_read_diagnostic';
  neutralAudienceDescription: string | null;
  readingOrderAliases: NonEmptyV6<string>;
  scopeDisclosure: 'complete_presented_prefix' | 'selected_excerpt_only';
}

export interface CharacterTurnPayloadV6 {
  kind: 'character_turn';
  requestAlias: string;
  actorAlias: string;
  sources: CharacterVisibleSourceV6[];
  visibleInteractionHistory: { speakerAlias: string; text: string }[];
  presentedInput:
    | { kind: 'in_world_action' | 'in_world_utterance'; text: string; supportingSourceAliases: string[] }
    | { kind: 'actor_safe_direction'; text: string; instructionAlias: string; compiledByHost: true };
  instruction: 'respond_as_one_character';
  permittedOutput: 'speech_and_observable_action';
  stopAfterOneTurn: true;
}

export type ContextSurfaceKindV6 = 'system_core' | 'skill_method' | 'operation' | 'messages' | 'tool_names_and_schemas' | 'attachments_and_titles' | 'retrieval_results' | 'memory_and_summaries' | 'prior_responses' | 'provider_state';

export interface PrivateContextSurfaceAuditV6 {
  surface: ContextSurfaceKindV6;
  contentHash: HashV6;
  permittedSourceAliases: string[];
  inspection: 'allowlist_compiled' | 'verified_static_instruction' | 'excluded';
  validatorVersion: string;
}

export interface PrivateScopedContextProofV6 {
  schemaVersion: 6;
  packetId: IdV6;
  taskId: IdV6;
  base: WorkBaseV6;
  runtimeCoreVariant: 'reader_prefix' | 'character_turn';
  coreHash: HashV6;
  methodHash: HashV6;
  operationHash: HashV6;
  outputSchemaHash: HashV6;
  serializedModelRequestHash: HashV6;
  sourceAliasBindings: { alias: string; version: VersionRefV5; sourceSpans: TextSourceSpanV5[]; visibilityBasisRefIds: IdV6[] }[];
  exposure: { includedPackagingVersions: VersionRefV5[]; narrativeCutoff: NarrativePointV3 | null; selectedExcerptVersions: VersionRefV5[]; coverage: 'complete_for_declared_prefix' | 'selected_excerpt_only' | 'partial' };
  actorKnowledgeBinding: { actorId: IdV6; acquisitionEventIds: IdV6[]; scopedBeliefProjectionIds: IdV6[]; hypotheticalObservationVersions: VersionRefV5[]; storyWindow: StoryWindowV3 | null } | null;
  auditedSurfaces: PrivateContextSurfaceAuditV6[];
  readSet: ReadSetV3;
  cacheNamespace: string;
  requestAudienceHash: HashV6;
  providerSession: { isolation: 'fresh_stateless_request' | 'verified_scoped_session'; sessionBindingHash: HashV6; priorResponseReferences: string[] };
  effectiveCapabilities: ('candidate.submit' | 'prose.return' | 'conversation.respond')[];
  status: 'unverified' | 'verified_by_host' | 'stale' | 'rejected';
  modelVisible: false;
}

export interface CompiledScopedPacketV6<T extends ReaderPrefixPayloadV6 | CharacterTurnPayloadV6> {
  modelPayload: T;
  hostPrivateProof: PrivateScopedContextProofV6;
}

export interface CharacterRehearsalTurnV6 {
  schemaVersion: 6;
  id: IdV6;
  experimentBranchId: IdV6;
  parentTurnId: IdV6 | null;
  branchHeadBefore: VersionRefV5 | null;
  actorId: IdV6;
  policyVersion: VersionRefV5;
  position: CreativePositionV6;
  contextPacketId: IdV6;
  contextRequestHash: HashV6;
  speechAndAction: string;
  proposedConsequences: { text: string; supportingVisibleCitations: ModelVisibleCitationV6[]; status: 'proposal' }[];
  turnVersion: VersionRefV5;
  state: 'candidate' | 'stale' | 'discarded';
  canonicalStateChanged: false;
}

export type PreferenceScopeV6 =
  | { kind: 'scene'; projectId: IdV6; branchId: IdV6; sceneId: IdV6 }
  | { kind: 'character'; projectId: IdV6; characterId: IdV6; sceneFunctions: string[] }
  | { kind: 'book'; projectId: IdV6; sceneFunctions: string[] }
  | { kind: 'explicit_author_reuse'; authorPrincipalId: IdV6; targetProjectIds: NonEmptyV6<IdV6>; authorizationDecisionId: IdV6 };

export type PreferenceEvidenceReasonV6 =
  | { kind: 'author_explained'; text: string; sourceRefs: NonEmptyV6<TextSourceSpanV5> }
  | { kind: 'unknown'; text: null };

export type PreferenceEvidenceEventV6 =
  | { kind: 'edit'; beforeVersion: VersionRefV5; afterVersion: VersionRefV5; changes: NonEmptyV6<{ before: TextSourceSpanV5 | null; after: TextSourceSpanV5 | null }>; editor: 'author' | 'model' | 'imported'; authorAcceptedChangeIds: IdV6[] }
  | { kind: 'selection'; experimentId: IdV6; observationId: IdV6; outcome: 'preferred' | 'rejected' | 'tie' | 'both_unsatisfactory'; selectedVersions: VersionRefV5[]; comparedVersions: NonEmptyV6<VersionRefV5> }
  | { kind: 'explicit_instruction'; sourceRefs: NonEmptyV6<TextSourceSpanV5> };

export interface PreferenceEvidenceV6 {
  schemaVersion: 6;
  id: IdV6;
  authorPrincipalId: IdV6;
  projectId: IdV6;
  event: PreferenceEvidenceEventV6;
  reason: PreferenceEvidenceReasonV6;
  scope: PreferenceScopeV6;
  issueDomain: 'expression' | 'narrative_focus' | 'plot' | 'character' | 'fact_correction' | 'unknown';
  voiceOwner: { kind: 'narrator' } | { kind: 'character'; characterId: IdV6 } | { kind: 'not_applicable' };
  observedAt: string;
  evidenceVersion: VersionRefV5;
  lifecycle: { state: 'active'; retractionEventId: null } | { state: 'retracted' | 'superseded'; retractionEventId: IdV6 };
  readSet: ReadSetV3;
}

export interface PreferenceLearningPolicyV6 {
  id: IdV6;
  version: VersionRefV5;
  authorPrincipalId: IdV6;
  evidenceCapture: 'enabled' | 'disabled';
  aggregation: 'on_request' | 'within_authorized_scope';
  activation: 'propose_only' | 'within_authorized_scope';
  authorizedScopes: PreferenceScopeV6[];
  authorizationDecisionId: IdV6;
  crossBookReuse: 'disabled' | 'explicit_targets_only';
}

export interface PreferenceHypothesisV6 {
  schemaVersion: 6;
  id: IdV6;
  statement: string;
  scope: PreferenceScopeV6;
  evidenceIds: NonEmptyV6<IdV6>;
  counterEvidenceIds: IdV6[];
  alternativeExplanations: string[];
  applicability: string[];
  exceptions: string[];
  issueDomain: PreferenceEvidenceV6['issueDomain'];
  basisReadSet: ReadSetV3;
  status: 'proposal' | 'insufficient_evidence' | 'stale' | 'retracted';
  desiredProfilePatch: { profileVersion: VersionRefV5; jsonPointer: string; proposedValue: JsonValueV5 } | null;
}

export interface PreferenceActivationV6 {
  id: IdV6;
  hypothesisIds: NonEmptyV6<IdV6>;
  evidenceVersions: NonEmptyV6<VersionRefV5>;
  learningPolicyVersion: VersionRefV5;
  authorizationDecisionId: IdV6;
  previousProfileVersion: VersionRefV5;
  resultingProfileVersion: VersionRefV5;
  acceptedChangeSetId: IdV6;
  state: 'active' | 'reversed' | 'needs_revalidation';
  reversalChangeSetId: IdV6 | null;
}

export interface SceneExpressionEvidenceV6 {
  projectId: IdV6;
  sceneId: IdV6;
  base: WorkBaseV6;
  voiceProfileVersion: VersionRefV5 | null;
  narratorPreferenceEvidenceIds: IdV6[];
  characterPreferenceEvidenceIds: { characterId: IdV6; evidenceIds: IdV6[] }[];
  attentionCues: { actorId: IdV6; statement: string; sourceRefIds: IdV6[]; status: 'supported' | 'proposed' }[];
  dialogueIntents: { actorId: IdV6; towardActorIds: IdV6[]; intention: string; sourceRefIds: IdV6[]; status: 'supported' | 'proposed' }[];
  treatment: { detail: string[]; compress: string[]; protectedText: TextSourceSpanV5[] };
  examples: { source: TextSourceSpanV5; evidenceId: IdV6; use: 'style_only'; sceneFunction: string }[];
  factualMaterial: { text: string; sourceRefs: NonEmptyV6<TextSourceSpanV5>; basis: 'author_world_rule' | 'verified_reference' | 'proposed_detail'; usableAsCanon: false }[];
  readSet: ReadSetV3;
}

export interface FirstReadObservationV6 {
  schemaVersion: 6;
  id: IdV6;
  requestAlias: string;
  packetId: IdV6;
  requestHash: HashV6;
  diagnosis: 'model_simulation';
  findings: { id: IdV6; kind: 'unclear_reference' | 'motivation_not_visible' | 'intentional_question' | 'exposition_repetition' | 'expectation_progress' | 'scene_transition' | 'other'; citations: NonEmptyV6<ModelVisibleCitationV6>; observation: string; alternativeInterpretations: string[]; suggestedLocalChange: string | null; severity: 'revise' | 'note' }[];
  nextQuestions: { question: string; supportingCitations: ModelVisibleCitationV6[] }[];
  limitations: string[];
  canonicalStateChanged: false;
}

export type ReadingExperienceBasisV6 =
  | { kind: 'prose_evidence'; sourceRefs: NonEmptyV6<TextSourceSpanV5>; eventRefIds: IdV6[] }
  | { kind: 'author_intent'; sourceRefs: NonEmptyV6<TextSourceSpanV5>; planVersion: VersionRefV5 }
  | { kind: 'model_interpretation'; observationId: IdV6; packetId: IdV6; supportingSourceRefs: TextSourceSpanV5[] }
  | { kind: 'human_feedback'; observationIds: NonEmptyV6<IdV6>; corpusVersion: VersionRefV5 };

export interface ReadingExperienceItemV6 {
  id: IdV6;
  promiseId: IdV6 | null;
  statement: string;
  kind: 'presented_information' | 'open_question' | 'progress' | 'partial_payoff' | 'payoff' | 'repeated_without_observed_progress' | 'comprehension_issue';
  position: NarrativePointV3;
  basis: ReadingExperienceBasisV6;
  linkedItemIds: IdV6[];
  intendedNextWindow: { from: NarrativePointV3 | null; through: NarrativePointV3 | null; sourcePlanVersion: VersionRefV5 } | null;
  bindingState: 'active' | 'stale';
}

export interface ReadingExperienceProjectionV6 {
  schemaVersion: 6;
  id: IdV6;
  scope: MemoryQueryScopeV3;
  sourceVersions: NonEmptyV6<VersionRefV5>;
  items: ReadingExperienceItemV6[];
  sourceReadSet: ReadSetV3;
  watermark: ProjectionWatermarkV5;
  derivedOnly: true;
  projectionHash: HashV6;
}

export interface PlotPatternRecordV6 {
  schemaVersion: 6;
  id: IdV6;
  projectId: IdV6;
  branchId: IdV6;
  sceneId: IdV6;
  scope: MemoryQueryScopeV3;
  proseVersion: VersionRefV5;
  sourceRefs: NonEmptyV6<TextSourceSpanV5>;
  eventRefIds: IdV6[];
  decomposition: { conflictSource: string | null; protagonistStrategy: string | null; opponentResponse: string | null; solutionBasis: string | null; substantiveChange: string | null; intendedReadingReward: string | null };
  interpretation: 'derived_model_interpretation' | 'author_confirmed_description';
  authorDecisionId: IdV6 | null;
  representationVersion: string;
  readSet: ReadSetV3;
  state: 'ready' | 'stale' | 'partial';
  authoritativeFactWriteAllowed: false;
}

export interface PatternComparisonV6 {
  schemaVersion: 6;
  id: IdV6;
  projectId: IdV6;
  proposedSceneVersion: VersionRefV5;
  policyVersion: VersionRefV5;
  retrievedPatternVersions: VersionRefV5[];
  retrievalCoverage: 'bounded_candidates' | 'complete_for_declared_scope';
  scope: MemoryQueryScopeV3;
  similarities: { patternId: IdV6; components: NonEmptyV6<keyof PlotPatternRecordV6['decomposition']>; candidateEvidence: NonEmptyV6<TextSourceSpanV5>; priorEvidence: NonEmptyV6<TextSourceSpanV5>; observation: string }[];
  meaningfulDifferences: string[];
  protectedRepetition: { reason: 'author_requested_echo' | 'mechanism_reuse_with_changed_conditions' | 'payoff' | 'other'; sourceRefs: NonEmptyV6<TextSourceSpanV5> }[];
  optionalChanges: { text: string; allowanceId: IdV6 | null; requiresNewAuthorization: boolean }[];
  readSet: ReadSetV3;
  result: 'no_supported_issue' | 'review_suggested' | 'insufficient_evidence';
  automaticPlotRewriteAllowed: false;
}

export type ComparisonKindV6 = 'voice_fixed_story' | 'plot_bounded_changes' | 'workflow_continuation';
export type ExperimentStageV6 = 'development' | 'holdout';

export interface QualityExperimentSpecV6 {
  schemaVersion: 6;
  id: IdV6;
  version: VersionRefV5;
  projectId: IdV6;
  comparisonKind: ComparisonKindV6;
  stage: ExperimentStageV6;
  taskSourceVersions: NonEmptyV6<VersionRefV5>;
  policyVersion: VersionRefV5;
  controlledFactors: { key: string; valueHash: HashV6 }[];
  variedFactors: NonEmptyV6<'model' | 'prompt' | 'context_compiler' | 'voice_evidence' | 'plot_choice' | 'revision_strategy'>;
  attribution: 'single_factor' | 'combined_change';
  permittedPlotChanges: string[];
  lengthPolicy: { unit: 'unicode_codepoint'; minimum: number; maximum: number };
  sceneFunctions: string[];
  targetAudience: string;
  evaluationQuestions: NonEmptyV6<string>;
  budget: CreativeBudgetV6;
  preregisteredAt: string;
  specificationHash: HashV6;
  decisions: { id: IdV6; criterion: string; kind: 'engineering_gate' | 'editorial_comparison' | 'exploratory_metric'; automaticLiteraryRejection: false }[];
}

export interface QualityRunRecordV6 {
  id: IdV6;
  experimentVersion: VersionRefV5;
  candidateVersion: VersionRefV5 | null;
  actualFactorBindings: Record<string, HashV6>;
  modelConfigHash: HashV6;
  workflowVersion: string;
  runtimeCoreHash: HashV6;
  skillPackageHash: HashV6;
  operationHash: HashV6;
  inputRequestHash: HashV6;
  readSet: ReadSetV3;
  status: 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown';
  usage: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; modelRequests: number; cost: { currency: string; amount: number; basis: 'provider_reported' | 'computed_estimate' } | null; timeToFirstReadableMs: number | null; timeToCandidateMs: number | null };
  engineeringFindings: { kind: 'constraint_violation' | 'source_error' | 'scope_violation' | 'structure_error'; sourceRefs: TextSourceSpanV5[]; description: string }[];
  artifactAvailability: 'complete' | 'partial' | 'unavailable';
}

export interface BlindPresentationV6 {
  id: IdV6;
  experimentId: IdV6;
  participantPseudonym: IdV6;
  sampleId: IdV6;
  presentationOrder: string[];
  visibleCandidates: { alias: string; text: string; visibleContentHash: HashV6 }[];
  declaredReadingContext: string;
  exposureHistory: { sampleId: IdV6; candidateContentHash: HashV6; exposureKind: 'first_read' | 'comparison' | 'revision_retest' }[];
}

export interface PrivateBlindPresentationBindingV6 {
  presentationId: IdV6;
  aliasBindings: { alias: string; candidateVersion: VersionRefV5; qualityRunId: IdV6 }[];
  randomization: { method: 'seeded_shuffle' | 'balanced_assignment'; seed: string; assignmentVersion: string };
  visiblePayloadHash: HashV6;
  modelVisible: false;
}

export type ReadingFeedbackOriginV6 =
  | { kind: 'human_author'; principalPseudonym: IdV6 }
  | { kind: 'human_target_reader'; participantPseudonym: IdV6; recruitmentDescription: string; audienceFit: 'declared_match' | 'unknown' }
  | { kind: 'model_simulation'; modelConfigHash: HashV6; scopedPacketId: IdV6; requestHash: HashV6 };

export interface ReadingFeedbackObservationV6 {
  schemaVersion: 6;
  id: IdV6;
  presentationId: IdV6;
  origin: ReadingFeedbackOriginV6;
  outcome: { kind: 'preferred'; alias: string } | { kind: 'tie' | 'both_unsatisfactory' | 'abstained' };
  annotations: { candidateAlias: string; visibleContentHash: HashV6; coordinateUnit: 'unicode_codepoint'; start: number; end: number; quote: string; category: 'continue_interest' | 'confusion' | 'repetition' | 'character_voice' | 'motivation' | 'other'; text: string }[];
  reasons: string[];
  receivedAt: string;
  lifecycle: 'active' | 'withdrawn';
  feedbackVersion: VersionRefV5;
}

export interface QualityComparisonReportV6 {
  schemaVersion: 6;
  id: IdV6;
  experimentVersion: VersionRefV5;
  status: 'ready' | 'insufficient_evidence' | 'incomparable';
  runIds: IdV6[];
  feedbackCorpusVersion: VersionRefV5;
  hostStatisticsVersion: VersionRefV5;
  hostStatisticsHash: HashV6;
  includedObservationIds: IdV6[];
  excludedObservations: { observationId: IdV6; reason: string }[];
  strata: { origin: ReadingFeedbackOriginV6['kind']; uniqueParticipants: number | null; validComparisons: number; winsByCandidateId: Record<IdV6, number>; ties: number; bothUnsatisfactory: number; abstentions: number; uncertaintyStatement: string }[];
  hardConstraintFailures: { runId: IdV6; findingIndexes: number[] }[];
  conclusions: { observation: string; supportingObservationIds: NonEmptyV6<IdV6>; alternatives: string[]; scopeLimitations: string[] }[];
  proposedNextExperiment: string | null;
  readSet: ReadSetV3;
  marketSuccessClaimAllowed: false;
}

export interface V6BridgeContract {
  designVersion: 'V6';
  memoryContractVersion: 3;
  worldContractVersion: 5;
  baseWorkflowPolicy: 'frozen_tasks_keep_original_contract';
  initializedWorkAdapter: 'explicit_scope_and_origin_resolution_required';
  sourceProjectionPolicy: 'derived_views_never_original_sources';
  optionalProjectionFailurePolicy: 'preserve_core_prose_memory_gate';
  validationState: 'design_only';
  adapterState: 'unavailable';
}

export type ReaderPrefixPacketV6 = ReaderPrefixPayloadV6;
export type CharacterTurnPacketV6 = CharacterTurnPayloadV6;

export interface ExplorationTaskV6 {
  schemaVersion: 6;
  taskId: IdV6;
  experimentBranch: ExplorationBranchV6;
  policy: CreativeTaskPolicyV6;
  requestedScene: string;
  position: CreativePositionV6;
  availableDesignVersions: VersionRefV5[];
  mandatorySourceRefs: TextSourceSpanV5[];
  optionalExpressionEvidence: SceneExpressionEvidenceV6 | null;
  unresolvedInputs: { issue: string; blocksThisTask: boolean }[];
  stopAt: string;
}

export interface PreferenceLearningCandidatesV6 {
  schemaVersion: 6;
  taskId: IdV6;
  policyVersion: VersionRefV5;
  evidenceVersions: VersionRefV5[];
  hypotheses: PreferenceHypothesisV6[];
  excludedEvidence: { evidenceId: IdV6; reason: string }[];
  unresolvedQuestions: string[];
  activeProfileChanged: false;
}

export type FirstReadReportV6 =
  | { state: 'ready'; report: FirstReadObservationV6 }
  | { state: 'invalid_packet'; requestAlias: string; reasonCodes: NonEmptyV6<string>; evaluatedText: false }
  | { state: 'insufficient_prefix'; requestAlias: string; availableSourceAliases: string[]; missingContextDescriptions: NonEmptyV6<string>; findings: FirstReadObservationV6['findings']; evaluatedWholeOpening: false };

export interface PlotPatternProjectionV6 {
  schemaVersion: 6;
  id: IdV6;
  scope: MemoryQueryScopeV3;
  records: PlotPatternRecordV6[];
  queryFingerprint: HashV6;
  retrievalCoverage: 'bounded_candidates' | 'complete_for_declared_scope';
  readSet: ReadSetV3;
  watermark: ProjectionWatermarkV5;
  projectionHash: HashV6;
  authoritativeFactWriteAllowed: false;
}

export interface BlindComparisonEvidenceV6 {
  schemaVersion: 6;
  experiment: QualityExperimentSpecV6;
  candidateAliases: { alias: string; candidateVersion: VersionRefV5; qualityRunId: IdV6 }[];
  observations: ReadingFeedbackObservationV6[];
  hostComputedStrata: QualityComparisonReportV6['strata'];
  hostStatisticsVersion: VersionRefV5;
  hostStatisticsHash: HashV6;
  corpusVersion: VersionRefV5;
  declaredComparisonScope: string;
  invalidOrMissingObservations: { observationId: IdV6 | null; reason: string }[];
  readSet: ReadSetV3;
}

export type FirstReadFindingModelV6 = Omit<FirstReadObservationV6['findings'][number], 'id'>;

export type FirstReadModelResultV6 =
  | { state: 'ready'; requestAlias: string; findings: FirstReadFindingModelV6[]; nextQuestions: FirstReadObservationV6['nextQuestions']; limitations: string[] }
  | { state: 'invalid_packet'; requestAlias: string; reasonCodes: NonEmptyV6<string>; evaluatedText: false }
  | { state: 'insufficient_prefix'; requestAlias: string; availableSourceAliases: string[]; missingContextDescriptions: NonEmptyV6<string>; findings: FirstReadFindingModelV6[]; evaluatedWholeOpening: false };

export interface CharacterRehearsalModelResultV6 {
  requestAlias: string;
  actorAlias: string;
  speechAndAction: string;
  proposedConsequences: CharacterRehearsalTurnV6['proposedConsequences'];
  unresolvedInformation: string[];
}

export interface CharacterTurnTaskPolicyV6 {
  requestAlias: string;
  responseLanguage: string;
  permittedOutput: 'speech_and_observable_action';
  ordinaryDetailPolicy: 'within_presented_scene' | 'do_not_add';
  maximumOutputCodepoints: number | null;
  numberOfActorTurns: 1;
  unsupportedKnowledge: 'preserve_character_uncertainty';
  failureDisclosure: 'visible_packet_facts_only';
}

export interface FirstReadTaskV6 {
  requestAlias: string;
  responseLanguage: string;
  expectedScope: 'presented_prefix' | 'selected_excerpt';
  maximumFindings: number | null;
  verdictScope: 'model_simulation_only';
  failureDisclosure: 'visible_packet_facts_only';
}

export interface IntentChangeProposalV6 {
  id: IdV6;
  target: ConstraintTargetV6;
  originalStatement: string;
  originalSourceRefs: NonEmptyV6<TextSourceSpanV5>;
  proposedStatement: string;
  allowanceId: IdV6;
  explicitConstraintChangeDecisionIds: IdV6[];
  relatedAdditionIds: IdV6[];
  dependentIntentChangeIds: IdV6[];
  requiredForScene: boolean;
}

export type ReadingTargetBriefV6 =
  | null
  | { kind: 'author_description'; text: string; sourceRefs: NonEmptyV6<TextSourceSpanV5> }
  | { kind: 'existing_card'; sourceVersion: VersionRefV5; knownValues: Partial<Pick<ReadingTargetCardV6, 'audienceDescription' | 'distinctivePremise' | 'intendedRewards' | 'openingPromise' | 'expressionPriorities' | 'authorTradeoffs'>>; requestedChanges: string[]; sourceRefs: TextSourceSpanV5[] };

export interface QualityComparisonModelResultV6 {
  conclusions: QualityComparisonReportV6['conclusions'];
  proposedNextExperiment: string | null;
}

export type QualityComparisonHostSnapshotV6 = Pick<QualityComparisonReportV6,
  'experimentVersion' | 'status' | 'runIds' | 'feedbackCorpusVersion' | 'hostStatisticsVersion' | 'hostStatisticsHash' | 'includedObservationIds' | 'excludedObservations' | 'strata' | 'hardConstraintFailures' | 'readSet'
>;

export interface QualityComparisonAssemblyReceiptV6 {
  id: IdV6;
  expectedHostStatisticsVersion: VersionRefV5;
  expectedHostStatisticsHash: HashV6;
  expectedFeedbackCorpusVersion: VersionRefV5;
  modelResultHash: HashV6;
  reportVersion: VersionRefV5 | null;
  state: 'assembled' | 'stale' | 'rejected';
  reasonCodes: string[];
  hostStatisticsChangedByModel: false;
}

export interface ReadingExperienceAdjunctPayloadV6 {
  schemaVersion: 6;
  basedOnBody: VersionRefV5;
  items: {
    proposalId: IdV6;
    kind: ReadingExperienceItemV6['kind'];
    statement: string;
    position: NarrativePointV3;
    sourceRefs: NonEmptyV6<TextSourceSpanV5>;
    promiseIds: IdV6[];
    interpretation: 'prose_observation' | 'model_hypothesis';
  }[];
}

export interface PlotPatternAdjunctPayloadV6 {
  schemaVersion: 6;
  basedOnBody: VersionRefV5;
  records: {
    proposalId: IdV6;
    sceneId: IdV6;
    sourceRefs: NonEmptyV6<TextSourceSpanV5>;
    eventRefIds: IdV6[];
    decomposition: PlotPatternRecordV6['decomposition'];
    interpretation: 'derived_model_interpretation';
  }[];
}

export interface NarrativeSubmissionEnvelopeV6<TCore = JsonValueV5> {
  core: TCore;
  adjuncts?: {
    readingExperience?: JsonValueV5;
    plotPatterns?: JsonValueV5;
  };
}

export type AdjunctValidationReceiptV6 =
  | { state: 'valid_for_projection'; rawPayloadHash: HashV6; validatedPayloadHash: HashV6; projectionCandidateId: IdV6; reasonCodes: [] }
  | { state: 'invalid'; rawPayloadHash: HashV6 | null; validatedPayloadHash: null; projectionCandidateId: null; reasonCodes: NonEmptyV6<string> }
  | { state: 'absent' | 'not_evaluated'; rawPayloadHash: HashV6 | null; validatedPayloadHash: null; projectionCandidateId: null; reasonCodes: string[] };

export type NarrativeSubmissionValidationReceiptV6 = {
  id: IdV6;
  transportBodyHash: HashV6;
  expectedBodyVersion: VersionRefV5;
  parserVersion: string;
  coreValidatorVersion: string;
  canonicalStateChanged: false;
} & (
  | { parseState: 'invalid_json'; core: { state: 'unavailable_due_to_transport'; coreArtifactHash: null; reasonCodes: NonEmptyV6<string> }; adjuncts: { readingExperience: { state: 'not_evaluated'; validatedPayloadHash: null }; plotPatterns: { state: 'not_evaluated'; validatedPayloadHash: null } }; coreDisposition: 'stop_core_workflow' }
  | { parseState: 'parsed'; core: { state: 'valid_for_this_gate'; coreArtifactHash: HashV6; reasonCodes: [] }; adjuncts: { readingExperience: AdjunctValidationReceiptV6; plotPatterns: AdjunctValidationReceiptV6 }; coreDisposition: 'continue_existing_core_workflow' }
  | { parseState: 'parsed'; core: { state: 'invalid'; coreArtifactHash: HashV6 | null; reasonCodes: NonEmptyV6<string> }; adjuncts: { readingExperience: AdjunctValidationReceiptV6; plotPatterns: AdjunctValidationReceiptV6 }; coreDisposition: 'stop_core_workflow' }
);
