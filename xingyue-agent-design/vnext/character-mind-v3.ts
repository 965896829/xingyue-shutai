import type { Hash, Id } from './contracts';

import type { NarrativePointV3, MemoryQueryScopeV3, ChapterMemoryCoverageV3, CharacterFacetV3, CharacterReviewStatusV3, MemoryDeltaV3, BeliefStanceV3 } from './memory-contracts-v3';

export type MindFacetV3 = CharacterFacetV3;
export type MindReviewStatusV3 = CharacterReviewStatusV3;

export type MindNarrativePointV3 = NarrativePointV3;

export type MindQueryViewV3 = MemoryQueryScopeV3;

export interface MindTimeBindingV3 {
  narrativePoint: MindNarrativePointV3;
  storyTimelineId: Id;
  storyEventRef: Id;
  firstRevealedAt?: MindNarrativePointV3;
}

export interface MindEvidenceV3 {
  sourceRefId: Id;
  sourceSpanRef?: Id;
  exactQuote: string;
  channel: 'author_confirmed' | 'reliable_narration' | 'explicit_inner_state' | 'utterance' | 'observable_behavior' | 'reported_claim' | 'ambiguous_narration' | 'model_inference';
  expressedBy?: Id;
  supports: 'world_event' | 'character_mental_state' | 'speech_event_only' | 'observable_behavior_only' | 'interpretation_candidate';
}

export interface CharacterCoreV3 {
  entityId: Id;
  revision: number;
  valuesAndConflicts: string[];
  enduringDesires: string[];
  protectedInterests: string[];
  vulnerabilities: string[];
  boundaries: string[];
  habitsAndStrategies: string[];
  voiceProfileRef?: Id;
  lockedRequirementRefs: Id[];
  sourceRefs: Id[];
}

export type MindObservationScopeV3 =
  | { kind: 'moment' }
  | { kind: 'scene'; sceneId: Id }
  | { kind: 'until_condition'; condition: string; conditionSourceRefs: Id[] }
  | { kind: 'unspecified' };

export interface MindEmotionV3 {
  labels: string[];
  targetRefs: Id[];
  triggerEventRefs: Id[];
  meaningToCharacter?: string;
  outwardExpression?: string;
  explicitInnerState?: string;
  lastObservedAt: MindTimeBindingV3;
  scope: MindObservationScopeV3;
}

export interface MindGoalV3 {
  text: string;
  motivation?: string;
  strategy?: string;
  horizon: 'immediate' | 'ongoing' | 'long_term';
  status: 'active' | 'blocked' | 'achieved' | 'abandoned' | 'uncertain';
  parentGoalRef?: Id;
  blockerRefs: Id[];
}

export interface MindBeliefV3 {
  holderId: Id;
  proposition: string;
  propositionRef?: Id;
  stance: BeliefStanceV3;
  acquiredThrough: 'observation' | 'communication' | 'reasoning' | 'recollection' | 'author_definition';
  acquisitionEventRefs: Id[];
  aboutAnotherMind?: { entityId: Id; nestedClaimRef: Id };
}

export interface MindRelationshipV3 {
  fromEntityId: Id;
  toEntityId: Id;
  dimension: string;
  stance: string;
  conditions: string[];
  causeEventRefs: Id[];
}

export interface MindBodyResourceV3 {
  property: string;
  value: string | number | boolean;
  unit?: string;
  applicableRuleRefs: Id[];
}

export interface MindCommitmentV3 {
  beneficiaryRefs: Id[];
  text: string;
  status: 'made' | 'active' | 'fulfilled' | 'broken' | 'released';
  conditions: string[];
  causeEventRefs: Id[];
}

export interface MindExpressionStrategyV3 {
  towardEntityRefs: Id[];
  intention: string;
  strategy: string;
  scope: MindObservationScopeV3;
}

export type MindStatePayloadV3 =
  | { facet: 'goal'; value: MindGoalV3 }
  | { facet: 'emotion'; value: MindEmotionV3 }
  | { facet: 'belief'; value: MindBeliefV3 }
  | { facet: 'relationship'; value: MindRelationshipV3 }
  | { facet: 'body_resource'; value: MindBodyResourceV3 }
  | { facet: 'commitment'; value: MindCommitmentV3 }
  | { facet: 'expression_strategy'; value: MindExpressionStrategyV3 };

export interface MindStateChangeProposalV3 {
  proposalKey: string;
  entityId: Id;
  operation: 'add' | 'transition' | 'end' | 'correct';
  previousStateRefs: Id[];
  payload: MindStatePayloadV3;
  time: MindTimeBindingV3;
  evidence: MindEvidenceV3[];
  interpretationStatus: 'explicitly_supported' | 'proposed_inference';
  dependsOnProposalKeys: string[];
}

export type MindCoverageV3 = ChapterMemoryCoverageV3<MindEvidenceV3>;

export interface ChapterMindDeltaProposalV3 {
  projectId: Id;
  branchId: Id;
  chapterId: Id;
  basedOnBodyHash: Hash;
  basedOnCanonRevisionId: Id;
  rosterHash: Hash;
  basedOnStateRevision: number;
  coverage: MindCoverageV3[];
  changes: MindStateChangeProposalV3[];
  unresolved: { entityRefs: Id[]; sourceRefs: Id[]; issue: string }[];
}

export interface CharacterInterpretationCandidateV3 {
  entityId: Id;
  text: string;
  basisEventRefs: Id[];
  basisStateRefs: Id[];
  affectedCoreFields: string[];
  status: 'candidate';
}

export interface CharacterMindProjectionV3 {
  entityId: Id;
  coreRevision: number;
  view: MindQueryViewV3;
  stateRefs: Id[];
  queryStatus: { stateRef: Id; availability: 'currently_supported' | 'last_observed_only' | 'currently_unknown' }[];
  relevantExperienceRefs: Id[];
  authoritativeInterpretationRefs: Id[];
  hostOwned: { projectionRevision: number; evidenceDigest: Hash; pendingChapterRefs: Id[] };
}

export interface MindPublicationReceiptV3 {
  chapterId: Id;
  acceptedBodyHash: Hash;
  branchId: Id;
  stateRevision: number;
  checkpointId: Id;
  coveredEntityRefs: Id[];
  unresolvedIdentityCount: number;
  hostOwned: true;
}

export type ChapterMemoryDeltaV3 = MemoryDeltaV3<ChapterMindDeltaProposalV3>;
