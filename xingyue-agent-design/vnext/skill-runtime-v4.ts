import type { MemoryQueryScopeV3, ReadSetV3 } from './memory-contracts-v3';

export type SkillCapabilityV4 = 'candidate.submit' | 'memory.query.scoped' | 'reference.read.scoped' | 'evidence.search.public' | 'prose.return' | 'conversation.respond';
export type SkillContextViewV4 = 'author_design' | 'scoped_pov' | 'author_review' | 'scoped_query';
export type SkillOutputBindingV4 = 'compat_adapter' | 'v3_adapter_required' | 'v4_adapter_required';
export type SkillResourceUseV4 = 'required' | 'conditional' | 'on_demand';

export interface SkillOperationBlueprintV4 {
  id: string;
  title: string;
  instructions: string;
  sourcePromptIds: string[];
  inputKinds: string[];
  outputKind: string;
  capabilitiesRequested: SkillCapabilityV4[];
  validators: string[];
  contextView: SkillContextViewV4;
  outputBinding: SkillOutputBindingV4;
}

export interface SkillBlueprintV4 {
  id: string;
  title: string;
  description: string;
  coreInstructions: string;
  sourcePromptIds: string[];
  operations: SkillOperationBlueprintV4[];
}

export interface SkillCatalogBlueprintV4 {
  designVersion: 'V4';
  skills: SkillBlueprintV4[];
}

export interface SkillResourceBindingV4 {
  resourceId: string;
  relativePath: string;
  sha256: string;
  kind: 'instructions' | 'reference' | 'schema' | 'asset';
  use: SkillResourceUseV4;
  selectorId?: string;
}

export type SkillAdapterBindingV4 =
  | { state: 'unavailable'; reason: string }
  | {
      state: 'available';
      adapterId: string;
      adapterVersion: string;
      inputSchemaId: string;
      inputSchemaHash: string;
      outputSchemaId: string;
      outputSchemaHash: string;
      outputMode: 'structured_submission' | 'prose_stream' | 'conversation_result';
      toolBindings: { capability: SkillCapabilityV4; actualToolName: string; schemaHash: string }[];
      validatorBindings: { id: string; version: string }[];
    };

export interface SkillOperationRegistrationV4 {
  operationId: string;
  targetKind?: string;
  workflowVersions: string[];
  inputKinds: string[];
  outputKind: string;
  requestedCapabilities: SkillCapabilityV4[];
  contextView: SkillContextViewV4;
  validatorIds: string[];
  resources: SkillResourceBindingV4[];
  adapter: SkillAdapterBindingV4;
  budgetPolicyId: string;
  provenanceBinding: SkillOutputBindingV4;
}

export interface SkillRegistrationV4 {
  manifestSchemaVersion: 2;
  skillId: string;
  skillVersion: string;
  packageDigest: string;
  entryTemplate: string;
  entrySha256: string;
  provenance: 'builtin' | 'user_override' | 'imported_static';
  active: boolean;
  operations: SkillOperationRegistrationV4[];
}

export interface SkillRegistryDesignV4 {
  manifestSchemaVersion: 2;
  designVersion: 'V4';
  activationState: 'design_only';
  baselineCommit: string;
  skills: SkillRegistrationV4[];
}

export interface ScopedCharacterPacketV4 {
  actorId: string;
  queryScope: MemoryQueryScopeV3 & { perspective: { kind: 'character'; actorId: string } };
  packetHash: string;
  evidenceIds: string[];
  readSetDigest: string;
}

export interface SkillExecutionSnapshotV4 {
  taskId: string;
  projectId: string;
  branchId: string;
  baseRevisionId: string;
  workflowVersion: string;
  skillId: string;
  skillVersion: string;
  operationId: string;
  targetKind?: string;
  coreHash: string;
  semanticResourceHash: string;
  resources: SkillResourceBindingV4[];
  adapterId: string;
  adapterVersion: string;
  inputSchemaId: string;
  inputSchemaHash: string;
  outputSchemaId: string;
  outputSchemaHash: string;
  modelConfigHash: string;
  readSet: ReadSetV3;
  readSetDigest: string;
  queryScope: MemoryQueryScopeV3;
  requiredActorIds: string[];
  actorPackets: ScopedCharacterPacketV4[];
  authorizationBindingId: string;
  effectiveCapabilities: SkillCapabilityV4[];
  toolBindings: { capability: SkillCapabilityV4; actualToolName: string; schemaHash: string }[];
  validatorBindings: { id: string; version: string }[];
  submission: { channel: 'structured_submission'; toolName: string; maxSubmissions: number } | { channel: 'prose_stream' | 'conversation_result' };
  repairPolicy: { maxAdditionalModelRequests: number; stopOnSameFailure: boolean };
  budget: { inputTokenLimit: number; outputTokenLimit: number; remainingCostLimit?: number };
}

export type SkillRunOutcomeV4 =
  | { state: 'candidate_ready'; taskId: string; candidateId: string; artifactHash: string; snapshotHash: string }
  | { state: 'accepted'; taskId: string; commitReceiptId: string; revisionId: string; snapshotHash: string }
  | { state: 'blocked'; taskId: string; code: string; missingResourceIds: string[] }
  | { state: 'stale'; taskId: string; invalidatedDependencyIds: string[] }
  | { state: 'outcome_unknown'; taskId: string; gatewayAttemptId: string; recoveryOwner: 'gateway' }
  | { state: 'failed'; taskId: string; errorCode: string; retryPolicyId: string };

export interface SkillEvaluationCaseV4 {
  id: string;
  category: string;
  request: string;
  fixture: Record<string, unknown>;
  expectedSkill: string | null;
  expectedOperation: string | null;
  assertions: string[];
  evaluationKind: 'local_contract' | 'model_output' | 'human_blind';
}
