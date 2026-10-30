import type { Id, Hash, SourceRef, StageId, AuthorRequirement } from './contracts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type CreativeObjectKind = 'concept' | 'plot' | 'book_outline' | 'volume_outline'
  | 'chapter_outline' | 'scene' | 'character' | 'relationship' | 'world_rule'
  | 'location' | 'faction' | 'voice_profile' | 'promise' | 'chapter_prose';
export type ContentLayer = 'accepted_prose' | 'confirmed_design' | 'plan' | 'candidate' | 'belief';
export type CoCreationIntent = 'discuss' | 'revise' | 'compare' | 'adopt' | 'revert';
export type RevisionSemantics = 'future_change' | 'correction' | 'retcon';

export interface CreativeObjectRef {
  objectId: Id;
  kind: CreativeObjectKind;
  locator: { documentId: Id; path: string; sectionId: Id; entityId?: Id };
}

export interface CreativeObjectVersion {
  ref: CreativeObjectRef;
  revision: number;
  bodyHash: Hash;
  layer: ContentLayer;
  value: JsonValue;
  sourceRefs: SourceRef[];
  effectiveChapters?: { from: number; through?: number };
  beliefHolderId?: Id;
  supersedesVersionRef?: Id;
}

export interface ObjectReadBinding {
  ref: CreativeObjectRef;
  revision: number;
  bodyHash: Hash;
  selectedFields: string[];
}

export interface ObjectScope {
  objectIds: Id[];
  fieldPaths: { objectId: Id; paths: string[] }[];
  allowedLayers: ContentLayer[];
  effectiveChapters?: { from: number; through?: number };
  revisionSemantics: RevisionSemantics;
}

export interface CreativeBranch {
  id: Id;
  name: string;
  parentBranchId?: Id;
  baseSnapshotId: Id;
  baseObjectVersions: ObjectReadBinding[];
  headCandidateIds: Id[];
  status: 'active' | 'merged' | 'archived';
}

export interface ObjectConversationBinding {
  conversationId: Id;
  projectId: Id;
  branchId: Id;
  focusObject: CreativeObjectRef;
  relatedObjectIds: Id[];
  lastReadSnapshotId: Id;
  lastDecisionMessageIds: Id[];
}

export type CoCreationAuthorization = {
  id: Id;
  scope: ObjectScope;
  explicitConstraintChangeIds: Id[];
  issuedAt: string;
} & (
  | { source: 'author_message'; authorMessageId: Id }
  | { source: 'author_control'; authorControlEventId: Id }
) & (
  | { mode: 'discussion' }
  | { mode: 'scoped_edit' }
  | { mode: 'adopt_candidate'; candidateBinding: { proposalId: Id; proposalHash: Hash; groupIds: Id[] } }
);

export interface CoCreationTurnInput {
  schemaVersion: 2;
  request: { messageId: Id; text: string; intent: Exclude<CoCreationIntent, 'adopt' | 'revert'> };
  binding: ObjectConversationBinding;
  focus: CreativeObjectVersion;
  related: CreativeObjectVersion[];
  requirements: AuthorRequirement[];
  branch?: CreativeBranch;
  comparison?: { branchId: Id; objects: CreativeObjectVersion[] }[];
  hostOwned: {
    authorization: CoCreationAuthorization;
    baseSnapshotId: Id;
    projectRevision: number;
    readSet: ObjectReadBinding[];
    actualStage: StageId;
    outputSchemaId: string;
    allowedToolNames: string[];
    maxModelCalls: number;
    maxRepairCalls: number;
  };
}

export type CreativeOperation =
  | { op: 'replace_field'; fieldPath: string; beforeValueHash: Hash; value: JsonValue }
  | { op: 'insert_item'; collectionPath: string; afterItemId?: Id; localKey: string; value: JsonValue }
  | { op: 'retire_item'; fieldPath: string; itemId: Id; beforeValueHash: Hash }
  | { op: 'replace_text'; startUTF16: number; endUTF16: number; originalQuote: string; replacement: string }
  | { op: 'revise_constraint'; requirementId: Id; beforeValueHash: Hash; value: string; lockAfter: boolean };

export interface CreativeChangeAtom {
  localId: Id;
  groupId: Id;
  target: CreativeObjectRef;
  baseRevision: number;
  baseBodyHash: Hash;
  operation: CreativeOperation;
  destinationLayer: ContentLayer;
  semantics: RevisionSemantics;
  effectiveChapters?: { from: number; through?: number };
  beliefHolderId?: Id;
  sourceRefIds: Id[];
  reason: string;
}

export interface CreativeChangeGroup {
  id: Id;
  title: string;
  changeIds: Id[];
  requiresGroupIds: Id[];
  preservedRequirementIds: Id[];
}

export interface CreativeProposalPayload {
  reply: string;
  changes: CreativeChangeAtom[];
  groups: CreativeChangeGroup[];
  proposedImpacts: { objectId: Id; effect: string; evidenceRefIds: Id[] }[];
  decisionNeeded?: { question: string; choices: { label: string; effect: string }[] };
}

export type CoCreationOutput =
  | { kind: 'chat'; reply: string; sourceRefIds: Id[] }
  | { kind: 'proposal'; proposal: CreativeProposalPayload };

export interface CreativeProposalRecord {
  id: Id;
  version: number;
  payload: CreativeProposalPayload;
  hostOwned: {
    proposalHash: Hash;
    baseSnapshotId: Id;
    validatedAgainstSnapshotId?: Id;
    branchId: Id;
    sourceTurnId: Id;
    readSet: ObjectReadBinding[];
    verifiedGroups: CreativeChangeGroup[];
    verifiedImpacts: {
      objectId: Id;
      consequence: 'invalidate_candidate' | 'recheck_plan' | 'recheck_fact' | 'refresh_view';
      sourceRefIds: Id[];
    }[];
    status: 'proposed' | 'validated' | 'applied' | 'stale' | 'rejected' | 'cancelled';
    unresolved: { kind: 'version' | 'scope' | 'requirement' | 'dependency' | 'source'; reason: string }[];
  };
}

export interface CoCreationApplyCommand {
  projectId: Id;
  proposalId: Id;
  proposalHash: Hash;
  selectedGroupIds: Id[];
  authorizationId: Id;
  expectedSnapshotId: Id;
  expectedObjectVersions: ObjectReadBinding[];
  operationId: Id;
}

export interface CoCreationApplyReceipt {
  operationId: Id;
  status: 'applied' | 'already_applied' | 'stale' | 'blocked';
  changesetId?: Id;
  snapshotId?: Id;
  acceptedGroupIds: Id[];
  updatedObjectVersions: ObjectReadBinding[];
  nextActions: { objectId: Id; action: 'review' | 'refresh'; reason: string }[];
  conflicts: { objectId?: Id; kind: 'version' | 'scope' | 'requirement' | 'dependency'; message: string }[];
}
