export type Id = string;
export type Hash = string;
export type StageId = 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07' | 'S08' | 'S09' | 'S10' | 'S11';
export type SourceKind = 'author_input' | 'accepted_prose' | 'confirmed_design' | 'plan' | 'candidate' | 'belief' | 'inference' | 'style_example' | 'market_evidence' | 'reader_feedback';
export interface SourceRef {
    id: Id;
    kind: SourceKind;
    documentId: Id;
    documentVersion: number;
    bodyHash: Hash;
    quote?: string;
    span?: {
        startUTF16: number;
        endUTF16: number;
    };
    worldId?: Id;
    timelineId?: Id;
    chapterRange?: [
        number,
        number
    ];
}
export interface AuthorRequirement {
    id: Id;
    kind: 'hard' | 'prohibited' | 'preference' | 'goal';
    text: string;
    originalQuote: string;
    sourceRef: Id;
    scope: {
        stages: StageId[];
        characterIds?: Id[];
        chapterRange?: [
            number,
            number
        ];
    };
    origin: 'explicit_field' | 'explicit_in_prose' | 'proposed_interpretation';
    status: 'active' | 'proposed' | 'superseded';
    supersedes?: Id;
}
export interface RequirementCoverage {
    requirementId: Id;
    candidateId: Id;
    status: 'supported' | 'conflict' | 'not_applicable';
    outputPointers: string[];
    evidence: string;
}
export interface AuthorContract {
    schemaVersion: 2;
    revision: number;
    sourceRefs: SourceRef[];
    requirements: AuthorRequirement[];
    unresolvedConflicts: {
        requirementIds: Id[];
        reason: string;
    }[];
    hostOwned: {
        inputHash: Hash;
        acceptedAt?: string;
        approvalId?: Id;
    };
}
export interface ReaderPromise {
    id: Id;
    audience: string;
    readingDesire: string;
    concretePremise: string;
    distinctiveChoice: string;
    firstObservablePayoff: string;
    longRunEngine: string;
    sourceRefs: Id[];
}
export interface PromiseItem {
    id: Id;
    text: string;
    sourceRefs: Id[];
    status: 'proposed' | 'introduced' | 'advanced' | 'fulfilled' | 'withdrawn_by_author';
    intendedWindow?: [
        number,
        number
    ];
    actualEvidenceRefs: Id[];
    consequence: string;
    coreEndingPromise: boolean;
}
export interface VoiceProfile {
    schemaVersion: 2;
    id: Id;
    revision: number;
    status: 'draft' | 'active' | 'retired';
    provenance: 'author_samples' | 'accepted_book_prose' | 'author_description' | 'generated_proposal';
    dimensions: {
        name: 'distance' | 'rhythm' | 'lexicon' | 'attention' | 'characterization' | 'dialogue' | 'exposition' | 'emotion' | 'payoff' | 'transition';
        preference: string;
        appliesWhen: string[];
        exceptions: string[];
        sourceRefs: Id[];
    }[];
    examples: {
        id: Id;
        text: string;
        sourceRef?: Id;
        synthetic: boolean;
        role: 'positive' | 'negative';
        illustrates: string[];
        allowedUse: 'style_only';
    }[];
    scope: {
        genres: string[];
        sceneFunctions: string[];
    };
    hostOwned: {
        activatedByApprovalId?: Id;
        calibrationIds: Id[];
    };
}
export interface CharacterVoice {
    entityId: Id;
    revision: number;
    sourceRefs: Id[];
    register: string;
    speechStrategies: string[];
    avoidsAdmitting: string[];
    attentionHabits: string[];
    relationshipModes: {
        relationship: string;
        adjustment: string;
        reason: string;
    }[];
    examples: {
        intention: string;
        line: string;
        synthetic: boolean;
    }[];
}
export interface SceneContract {
    schemaVersion: 2;
    id: Id;
    chapter: number;
    revision: number;
    viewpoint: {
        entityId?: Id;
        mode: string;
        distance: string;
    };
    participants: {
        entityId: Id;
        immediateWant: string;
        pressure: string;
        speechIntent: string;
        knowledgeRef: Id;
    }[];
    entryStateRefs: Id[];
    scenes: {
        id: Id;
        narrativeFunction: string;
        immediateQuestion: string;
        requiredBeats: string[];
        optionalTexture: string[];
        choice: string;
        response: string;
        intendedStateChange: string;
        readerMustUnderstand: string[];
        mayRevealRefs: Id[];
        mustNotRevealRefs: Id[];
        emotionalMovement?: {
            from: string;
            to: string;
        };
        exitPull?: string;
    }[];
    promiseIds: Id[];
    immutableFactRefs: Id[];
    blockedReasons: string[];
    hostOwned: {
        planHash: Hash;
        canonSnapshotId: Id;
        approvedAt?: string;
    };
}
export interface PlanningWindow {
    schemaVersion: 2;
    projectId: Id;
    revision: number;
    coarseRange: [
        number,
        number
    ];
    detailedRange: [
        number,
        number
    ];
    frozenChapterIds: Id[];
    editableRange: [
        number,
        number
    ];
    milestoneIds: Id[];
    duePromiseIds: Id[];
    hostOwned: {
        workflowVersion: 'rolling-v2';
        baseSnapshotId: Id;
    };
}
export interface NameMapEntry {
    entityId: Id;
    confirmedName: string;
    allowedReferences: string[];
    unknownNameTo: Id[];
    sourceRefs: Id[];
}
export interface CanonSnapshot {
    id: Id;
    revision: number;
    worldId: Id;
    timelineId: Id;
    facts: {
        id: Id;
        kind: Extract<SourceKind, 'accepted_prose' | 'confirmed_design'>;
        text: string;
        sourceRefs: Id[];
        knownBy: Id[];
        validFromChapter: number;
        validToChapter?: number;
        mandatory: boolean;
        supersedes?: Id;
    }[];
}
export interface StageContract {
    stage: StageId | 'directions' | 'title' | 'calibration' | 'reader_feedback' | 'ending_audit';
    outputMode: 'prose' | 'existing_tool' | 'vnext_tool';
    actualToolName?: string;
    outputSchemaId: string;
    allowedPaths: string[];
    frozenIds: Id[];
    maxSubmissions: number;
    allowedMutation: string;
    blockedOutput: {
        mode: 'host_preflight_only' | 'dedicated_tool';
        toolName?: 'report_stage_blocker';
    };
}
export interface TaskPacket {
    packetVersion: 2;
    identity: {
        projectId: Id;
        taskId: Id;
        attemptId: Id;
        requestId: Id;
        epoch: number;
    };
    stageContract: StageContract;
    authorContract: AuthorContract;
    canon: CanonSnapshot;
    sourceRefs: SourceRef[];
    scene?: SceneContract;
    planningWindow?: PlanningWindow;
    voice?: {
        profileId: Id;
        revision: number;
        selectedDimensionNames: string[];
        rules: string[];
        examples: VoiceProfile['examples'];
        characters: CharacterVoice[];
    };
    names: NameMapEntry[];
    retrievalManifest: {
        sourceRefId: Id;
        required: boolean;
        reason: string;
    }[];
    hostOwned: {
        compilerVersion: string;
        promptHash: Hash;
        modelProfileVersion: string;
        inputHash: Hash;
        maxInputTokens: number;
        reservedOutputTokens: number;
        maxModelCalls: number;
        maxRepairCalls: number;
        moneyRemaining?: number;
    };
}
export interface ProsePatch {
    baseBodyHash: Hash;
    patches: {
        issueId: Id;
        startUTF16: number;
        endUTF16: number;
        originalQuote: string;
        replacement: string;
        readerEffect: string;
    }[];
    preservedFacts: Id[];
    needsPlotRevision: {
        issueId: Id;
        reason: string;
    }[];
}
export interface EvidenceFinding {
    id: Id;
    candidateHash: Hash;
    severity: 'blocker' | 'revise' | 'note';
    aspect: '开头有效性' | '主角主动性' | '人物一致性' | '信息落地' | '章末牵引';
    quote: string;
    sourceRef: Id;
    readerEffect: string;
    minimalRepair: string;
    allowedRange?: {
        startUTF16: number;
        endUTF16: number;
    };
}
export interface ReviewReportV2 {
    schemaVersion: 2;
    candidateHash: Hash;
    checks: {
        aspect: EvidenceFinding['aspect'];
        verdict: 'pass' | 'warning' | 'error';
        quote: string;
        reason: string;
    }[];
    findings: EvidenceFinding[];
}
export interface StageBlocker {
    reason: string;
    requirementIds: Id[];
    sourceRefs: Id[];
    missingOrConflictingItems: string[];
}
export interface ReaderObservation {
    id: Id;
    source: string;
    capturedAt: string;
    chapterVersionRefs: Id[];
    observationWindow: string;
    sampleSize?: number;
    metricDefinition?: string;
    synthetic: boolean;
    content: string;
    audienceOrExposureChange?: string;
}
export type TaskState = 'compiled' | 'requesting' | 'outcome_unknown' | 'candidate_received' | 'locally_validated' | 'reviewing' | 'repair_pending' | 'awaiting_author' | 'accepted' | 'rejected' | 'blocked' | 'cancelled';
export interface AttemptBinding {
    taskId: Id;
    attemptId: Id;
    epoch: number;
    inputHash: Hash;
    promptVersion: string;
    promptHash: Hash;
    modelProfileVersion: string;
    candidateHash?: Hash;
    sourceSnapshotId: Id;
    state: TaskState;
}
export type VoiceProfileV2 = VoiceProfile;
export type CharacterVoiceV2 = CharacterVoice;
export interface VoiceSlice {
    profileId: Id;
    revision: number;
    selectedDimensionNames: string[];
    rules: string[];
    examples: VoiceProfile['examples'];
    characters: CharacterVoice[];
}
export interface AssumptionV2 {
    id: Id;
    text: string;
    critical: boolean;
    directionIds: Id[];
    sourceRefs: Id[];
    status: 'proposed' | 'accepted' | 'rejected';
}
export interface IntentChangeV2 {
    id: Id;
    originalSourceRef: Id;
    original: string;
    proposed: string;
    directionIds: Id[];
    reason: string;
}
export interface DirectionCoreV2 {
    id: Id;
    title: string;
    logline: string;
    storyEngine: string;
    openingDecision: string;
    firstVolumeChange: string;
    longRunRisk: string;
    intentChanges: IntentChangeV2[];
}
export interface DirectionBatchViewV2 {
    schemaVersion: 2;
    positioning: string;
    directions: DirectionCoreV2[];
    assumptions: AssumptionV2[];
    batchComparison: {
        directionId: Id;
        difference: string;
    }[];
    recommendedDirectionId: Id;
    recommendationReasons: string[];
    requirementCoverage: RequirementCoverage[];
}
export type DirectionReportV2 = {
    mode: 'new';
    report: DirectionBatchViewV2;
    proposedRequirements: AuthorRequirement[];
} | {
    mode: 'regenerate';
    baseReportHash: Hash;
    replacements: DirectionCoreV2[];
    assumptionChanges: {
        operation: 'add' | 'replace' | 'remove';
        id: Id;
        value?: AssumptionV2;
    }[];
    batchComparison: DirectionBatchViewV2['batchComparison'];
    recommendedDirectionId: Id;
    recommendationReasons: string[];
    requirementCoverage: RequirementCoverage[];
};
export interface StoryContractV2 {
    schemaVersion: 2;
    selectedDirectionId: Id;
    premise: string;
    readerPromise: ReaderPromise;
    recurringConflict: {
        action: string;
        counteraction: string;
        cost: string;
        payoff: string;
        nextProblem: string;
        variation: string;
    };
    coreCharacterChoices: {
        entityId: Id;
        want: string;
        decisionPattern: string;
        sourceRefs: Id[];
    }[];
    relationshipTensions: {
        entityIds: Id[];
        interests: string;
        sourceRefs: Id[];
    }[];
    keyRules: {
        id: Id;
        statement: string;
        sourceRefs: Id[];
        status: 'confirmed' | 'proposed';
    }[];
    firstVolumeChange: string;
    endingPromiseIds: Id[];
    promises: PromiseItem[];
    assumptions: AssumptionV2[];
    unresolvedChoices: string[];
    requirementCoverage: RequirementCoverage[];
}
export interface PilotBatch {
    sceneContractId: Id;
    variants: {
        candidateId: Id;
        profileId: Id;
        prose: string;
        modelClaimedFactPreservation: string[];
        expressionDifferences: string[];
    }[];
}
export interface VoiceCalibrationOutput {
    profileDraft: Omit<VoiceProfile, 'status' | 'hostOwned' | 'revision'>;
    variants: PilotBatch['variants'];
    uncertainties: {
        dimension: string;
        reason: string;
    }[];
}
