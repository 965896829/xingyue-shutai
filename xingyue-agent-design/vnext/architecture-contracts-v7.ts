import type { ChapterMemoryBatchV3, MemoryOutboxJobV3, ReadSetV3 } from './memory-contracts-v3';
import type { ChapterMemoryDeltaV3 } from './character-mind-v3';
import type { HashV5, IdV5, JsonValueV5, ObjectAuthorityV5, ProjectionWatermarkV5, VersionRefV5 } from './world-contracts-v5';
import type { CharacterTurnPayloadV6, CompiledScopedPacketV6, CreativeTaskPolicyV6, ReaderPrefixPayloadV6, RuntimeCoreVariantV6 } from './quality-creative-contracts-v6';
import type { SkillOperationRegistrationV6 } from './skill-runtime-v6';

export type WorkflowKindV7 = 'creation' | 'chapter' | 'discussion' | 'revision';
export type RuntimeModuleV7 = 'application_commands' | 'workflow' | 'capability_registry' | 'context_compiler' | 'executor' | 'model_gateway' | 'tool_gateway' | 'story_domain' | 'commit_kernel' | 'projection';
export type ToolEffectV7 = 'read' | 'draft_write' | 'candidate_proposal';

export interface ResourceContractRefV7 {
  id: string;
  version: string;
  sha256: HashV5;
}

export interface OperationRefV7 {
  skillId: string;
  operationId: string;
  targetKind: string | null;
}

export type TaskDependencyV7 =
  | { kind: 'required_artifact'; objectKind: string; acceptedRequired: boolean; sourceVersion: VersionRefV5 | null; missingBehavior: 'block_dependent_task' | 'allow_isolated_exploration' }
  | { kind: 'read_set'; readSet: ReadSetV3; recheck: 'before_dispatch_and_before_candidate_apply' }
  | { kind: 'required_validator'; contract: ResourceContractRefV7 };

export interface WorkflowNodeV7 {
  id: string;
  action: { kind: 'model_operation'; operation: OperationRefV7 } | { kind: 'host_action'; handlerId: string };
  dependencies: TaskDependencyV7[];
  resourceLocks: string[];
  onReady: string[];
  onBlocked: 'park_existing_execution';
  waitForAuthor: 'only_when_current_authorization_is_insufficient';
}

export interface WorkflowDefinitionV7 {
  schemaVersion: 7;
  id: string;
  kind: WorkflowKindV7;
  version: string;
  entryNodeIds: string[];
  nodes: WorkflowNodeV7[];
  stageNavigation: 'retain_S01_S11_as_guidance';
  eligibilityAuthority: 'host_verified_dependencies';
  activation: { state: 'design_only'; active: false; adapter: 'unavailable' };
}

export type HostExecutionReferenceV7 =
  | { kind: 'run'; runId: IdV5; expectedStateVersion: number; executionRecordId: IdV5 }
  | { kind: 'conversation_turn'; turnId: IdV5; expectedTurnFingerprint: HashV5 };

export interface RecoveryBindingV7 {
  existingExecution: HostExecutionReferenceV7;
  executorId: string;
  executorVersion: string;
  checkpointVersion: number;
  workflowVersion: string;
  handlerContract: ResourceContractRefV7;
  modelProfileVersion: ResourceContractRefV7;
  restorePolicy: 'recorded_versions_only';
  remoteUnknownPolicy: 'retain_receipt_and_require_host_resolution';
  retryOwner: 'existing_model_gateway';
  frameworkAutomaticRetries: 0;
}

export type ExplicitToolContractV7 = {
  toolName: string;
  inputSchema: ResourceContractRefV7;
  outputSchema: ResourceContractRefV7;
  outputByteLimit: number;
  contextPolicy: ResourceContractRefV7;
  authority: 'host_verified';
  canonicalCommitAllowed: false;
  receiptOwner: 'existing_tool_executions';
} & (
  | { effect: 'read'; writeScope: null; unknownOutcome: 'host_revalidates_scope_cost_and_retry_before_repeat' }
  | { effect: 'draft_write' | 'candidate_proposal'; writeScope: { branchId: IdV5; objectIds: IdV5[]; fieldPaths: string[] }; unknownOutcome: 'no_automatic_reexecution' }
);

export interface OperationBindingV7 {
  ref: OperationRefV7;
  retainedRegistration: SkillOperationRegistrationV6;
  handlerContract: ResourceContractRefV7;
  inputSchema: ResourceContractRefV7;
  outputSchema: ResourceContractRefV7;
  contextPolicy: ResourceContractRefV7;
  toolContracts: ExplicitToolContractV7[];
  validators: ResourceContractRefV7[];
  activation: { state: 'design_only'; active: false; adapter: 'unavailable' };
}

export interface TaskSpecV7 {
  schemaVersion: 7;
  taskId: IdV5;
  workflow: { id: string; kind: WorkflowKindV7; version: string; nodeId: string };
  operation: OperationRefV7;
  policy: CreativeTaskPolicyV6;
  dependencies: TaskDependencyV7[];
  recovery: RecoveryBindingV7;
  resourceLocks: string[];
  budgetOwner: { parentRunId: IdV5 | null; ledger: 'existing_model_attempts'; repairAndChildRequestsIncluded: true };
  commandReceiptId: IdV5 | null;
  commandReceiptOwner: 'existing_operations';
  registryOwner: 'capability_registry';
  hostOnly: true;
  modelSerialization: 'compiled_model_payload_only';
}

export type CompiledTaskContextV7<TAuthorPayload extends JsonValueV5 = JsonValueV5> =
  | { runtimeCoreVariant: 'author'; taskId: IdV5; modelPayload: TAuthorPayload; hostPrivate: { policyVersion: VersionRefV5; readSet: ReadSetV3; serializedModelRequestHash: HashV5; requestAudienceHash: HashV5; modelVisible: false } }
  | { runtimeCoreVariant: 'reader_prefix'; taskId: IdV5; packet: CompiledScopedPacketV6<ReaderPrefixPayloadV6> }
  | { runtimeCoreVariant: 'character_turn'; taskId: IdV5; packet: CompiledScopedPacketV6<CharacterTurnPayloadV6> };

export interface CandidateArtifactV7 {
  artifactKind: string;
  version: VersionRefV5;
  authority: Extract<ObjectAuthorityV5, { lane: 'candidate' }>;
}

export type TaskResultV7 = {
  taskId: IdV5;
  existingExecution: HostExecutionReferenceV7;
  canonicalStateChanged: false;
} & (
  | { state: 'candidate_ready'; artifacts: CandidateArtifactV7[]; readSet: ReadSetV3; validationReceiptIds: IdV5[]; allowedNextOperationRefs: OperationRefV7[] }
  | { state: 'read_only_complete'; resultArtifactVersion: VersionRefV5; authority: Extract<ObjectAuthorityV5, { lane: 'derived' }>; readSet: ReadSetV3 }
  | { state: 'blocked'; reasonCodes: string[]; unresolvedDependencyIds: string[] }
  | { state: 'outcome_unknown'; existingModelAttemptId: IdV5; recoveryOwner: 'existing_model_gateway' }
);

export interface CoreChapterCandidateV7 {
  schemaVersion: 7;
  taskId: IdV5;
  sourceProseVersion: VersionRefV5;
  coreMemory: ChapterMemoryDeltaV3;
  coverageBatch: ChapterMemoryBatchV3;
  readSet: ReadSetV3;
  existingCandidateId: IdV5;
  existingChangeSetId: IdV5;
  expectedAuthorPolicyVersion: VersionRefV5;
  hostValidationReceiptIds: IdV5[];
  formalCommitOwner: 'existing_commit_kernel';
  coreCommitPolicy: 'prose_and_required_memory_same_revision';
  optionalProjectionFailureBlocksCommit: false;
}

export interface ProjectionBindingV7 {
  existingOutboxJob: MemoryOutboxJobV3 & { kind: 'index' | 'project' | 'invalidate' | 'consolidate' };
  sourceVersionRefs: VersionRefV5[];
  readSet: ReadSetV3;
  watermark: ProjectionWatermarkV5;
  kind: 'character' | 'relationship' | 'knowledge' | 'promise' | 'timeline' | 'reading_experience' | 'plot_pattern' | 'retrieval_index';
  derivation: 'deterministic_local' | 'explicit_semantic_analysis';
  regenerationOwner: 'existing_outbox_dispatch';
  authority: 'derived';
  failurePolicy: 'mark_stale_or_failed_and_rebuild';
  canonicalStateChanged: false;
}

export interface ArchitectureActivationGateV7 {
  operation: OperationRefV7;
  runtimeCoreVariant: RuntimeCoreVariantV6;
  evidenceRequired: readonly ['handler_implemented', 'runtime_schema_validated', 'whole_request_scope_verified', 'existing_gateway_integrated', 'candidate_commit_invariants_preserved', 'recorded_version_restore_verified'];
  currentState: 'unavailable';
  active: false;
}
