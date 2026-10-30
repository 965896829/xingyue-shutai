import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const repositoryIndex = args.indexOf('--repository');
if (repositoryIndex < 0 || !args[repositoryIndex + 1]) throw new Error('--repository is required');
const repository = path.resolve(args[repositoryIndex + 1]);
const require = createRequire(path.join(repository, 'package.json'));
const Ajv = require('ajv');
const ts = require('typescript');
const checkerFile = fileURLToPath(import.meta.url);
const pack = path.resolve(path.dirname(checkerFile), '..');
const auditFile = path.join(pack, 'audit/architecture-static-verification-v7.json');
const baselineCommit = 'b505f6f459db74871f39f63acf6106b827c8a353';
const phaseIds = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];
const workflowKinds = ['creation', 'chapter', 'discussion', 'revision'];
const tierCountsExpected = { local_contract: 8, app_integration: 14, performance: 2 };
const tiers = Object.keys(tierCountsExpected);
const checks = [];
const inputFiles = new Map();
const externalInputs = new Map();
let counts = {};
let virtualWitnessHash = null;
const shaBuffer = value => crypto.createHash('sha256').update(value).digest('hex');
const sha = file => shaBuffer(fs.readFileSync(file));
const sorted = values => [...values].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unique = values => [...new Set(values)];
const verify = (name, condition, details = {}) => {
  checks.push({ name, passed: Boolean(condition), ...details });
  if (!condition) throw new Error(name);
};
const resource = relative => {
  const full = path.resolve(pack, relative);
  const exists = !path.isAbsolute(relative) && full.startsWith(pack + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile();
  verify('contained-file:' + relative, exists && fs.realpathSync(full).startsWith(fs.realpathSync(pack) + path.sep));
  const digest = sha(full);
  verify('consistent-input-read:' + relative, !inputFiles.has(relative) || inputFiles.get(relative) === digest);
  inputFiles.set(relative, digest);
  return full;
};
const text = relative => fs.readFileSync(resource(relative), 'utf8');
const load = relative => JSON.parse(text(relative));
const external = file => {
  const full = path.resolve(file);
  const label = full.startsWith(repository + path.sep) ? '[repository]/' + path.relative(repository, full).split(path.sep).join('/') : full;
  externalInputs.set(label, { file: full, sha256: sha(full) });
};
const stringSchema = { type: 'string', minLength: 1 };
const stringsSchema = { type: 'array', items: stringSchema };
const nonemptyStringsSchema = { ...stringsSchema, minItems: 1 };
const idRefSchema = { type: 'object', additionalProperties: false, required: ['skillId', 'operationId', 'targetKind', 'defaultWorkflow', 'contextVariant', 'registrationSource', 'active', 'adapter'], properties: { skillId: stringSchema, operationId: stringSchema, targetKind: { anyOf: [stringSchema, { type: 'null' }] }, defaultWorkflow: { enum: workflowKinds }, contextVariant: { enum: ['author', 'reader_prefix', 'character_turn'] }, registrationSource: { const: 'vnext/skills-v6/registry.design.json' }, active: { const: false }, adapter: { const: 'unavailable' } } };
const policySchema = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'designVersion', 'activationState', 'baselineVersion', 'baselineCommit', 'purpose', 'retainedCatalog', 'deployment', 'authority', 'preservedInvariants', 'workflowRouting', 'operationBindings', 'taskContract', 'toolEffects', 'context', 'chapterClosure', 'memoryScale', 'projections', 'activationEvidenceRequired', 'migrationOrder', 'behaviorExecutionStatus', 'frameworkReevaluation', 'migrationPhases'],
  properties: {
    schemaVersion: { const: 7 }, designVersion: { const: 'V7' }, activationState: { const: 'design_only' }, baselineVersion: { const: '0.4.82' }, baselineCommit: { const: baselineCommit }, purpose: stringSchema,
    retainedCatalog: { type: 'object', additionalProperties: false, required: ['designVersion', 'registry', 'skillPackages', 'operations', 'registrationBindings', 'promptSourceResources', 'contentPreservation'], properties: { designVersion: { const: 'V6' }, registry: { const: 'vnext/skills-v6/registry.design.json' }, skillPackages: { const: 19 }, operations: { const: 48 }, registrationBindings: { const: 50 }, promptSourceResources: { const: 112 }, contentPreservation: { const: 'unchanged' } } },
    deployment: { type: 'object' }, authority: { type: 'object' }, preservedInvariants: { ...nonemptyStringsSchema, uniqueItems: true }, workflowRouting: { type: 'object' }, operationBindings: { type: 'array', minItems: 50, maxItems: 50, items: idRefSchema }, taskContract: { type: 'object' }, toolEffects: { type: 'object' }, context: { type: 'object' }, chapterClosure: { type: 'object' }, memoryScale: { type: 'object' }, projections: { type: 'object' }, activationEvidenceRequired: { ...nonemptyStringsSchema, uniqueItems: true }, migrationOrder: { type: 'array', minItems: 6, maxItems: 6, uniqueItems: true, items: stringSchema }, behaviorExecutionStatus: { const: 'not_executed_by_this_blueprint' }, frameworkReevaluation: { type: 'object' }, migrationPhases: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['id', 'action'], properties: { id: { enum: phaseIds }, action: stringSchema } } }
  }
};
const caseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'tier', 'phase', 'feature', 'target', 'given', 'when', 'expected', 'fixtures', 'oracle', 'requires', 'evidenceOutputs', 'reuseTests', 'status', 'executionCount'],
  properties: {
    id: { type: 'string', pattern: '^V7-A-[0-9]{2}$' }, tier: { enum: tiers }, phase: { enum: phaseIds }, feature: stringSchema, target: stringSchema, given: stringSchema, when: stringSchema, expected: nonemptyStringsSchema, fixtures: nonemptyStringsSchema,
    oracle: { type: 'object', additionalProperties: false, required: ['owner', 'method', 'mustNotReachModel'], properties: { owner: { const: 'host_or_test_harness' }, method: stringSchema, mustNotReachModel: { ...nonemptyStringsSchema, uniqueItems: true } } },
    requires: nonemptyStringsSchema, evidenceOutputs: nonemptyStringsSchema, reuseTests: stringsSchema, status: { const: 'not_run' }, executionCount: { const: 0 }
  }
};
const suiteSchema = {
  type: 'object', additionalProperties: false,
  required: ['designVersion', 'suiteId', 'createdAt', 'sourceBaseline', 'status', 'executionCount', 'scope', 'executionGuidance', 'coverage', 'cases'],
  properties: {
    designVersion: { const: 'V7' }, suiteId: { const: 'xingyue-architecture-v7' }, createdAt: stringSchema,
    sourceBaseline: { type: 'object', additionalProperties: false, required: ['version', 'commit', 'repository'], properties: { version: { const: '0.4.82' }, commit: { const: baselineCommit }, repository: { const: 'https://github.com/965896829/xingyue-shutai.git' } } },
    status: { const: 'not_run' }, executionCount: { const: 0 }, scope: stringSchema,
    executionGuidance: { type: 'object', additionalProperties: stringSchema, required: ['implementation', 'modelInput', 'layers', 'cost', 'performance', 'status'], properties: Object.fromEntries(['implementation', 'modelInput', 'layers', 'cost', 'performance', 'status'].map(key => [key, stringSchema])) },
    coverage: { type: 'object', additionalProperties: false, required: ['total', 'byTier', 'executed', 'inheritedSuites', 'notCoveredByThisSuite'], properties: { total: { const: 24 }, byTier: { type: 'object', additionalProperties: false, required: tiers, properties: Object.fromEntries(Object.entries(tierCountsExpected).map(([tier, count]) => [tier, { const: count }])) }, executed: { const: 0 }, inheritedSuites: { ...nonemptyStringsSchema, uniqueItems: true }, notCoveredByThisSuite: nonemptyStringsSchema } },
    cases: { type: 'array', minItems: 24, maxItems: 24, items: caseSchema }
  }
};
const sourceSchema = { type: 'object', additionalProperties: false, required: ['designVersion', 'baselineCommit', 'reviewDate', 'sources'], properties: { designVersion: { const: 'V7' }, baselineCommit: { const: baselineCommit }, reviewDate: stringSchema, sources: { type: 'array', minItems: 26, maxItems: 26, items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'url', 'scope'], properties: { id: { type: 'string', pattern: '^V7[CR][0-9]{2}$' }, title: stringSchema, url: stringSchema, scope: stringSchema } } } } };
const limits = [
  'Static design-file verification only. No application handler, model request, tool execution, formal commit, recovery path, cache boundary or user interface is executed.',
  'All 24 V7 scenario definitions remain not_run with executionCount 0. Passing schema and type checks does not execute local_contract, app_integration or performance cases.',
  'The retained V6 model_output and human_blind evaluations are not executed. No literary quality, reader preference, commercial performance or million-character runtime conclusion is inferred.',
  'TypeScript compilation and Ajv checks apply to design artifacts. Runtime model-tool schemas, adapters and implementation validators remain unavailable.',
  'Source checks validate declared fixed-commit and official URL forms; they do not browse, re-fetch or prove the contents of the cited remote pages.',
  'SHA-256 checks bind this output to observed local inputs. They do not make a model-generated result canonical or authorize a product implementation.',
  'No network request, provider call, paid model use or change to the source repository is performed.'
];
const emit = (status, error = null) => {
  const result = { designVersion: 'V7', status, scope: 'static design-artifact verification only', checkedAt: new Date().toISOString(), baselineCommit, checkerSha256: sha(checkerFile), ...counts, behaviorCasesExecuted: 0, runtimeIntegrationExecuted: false, modelCalls: 0, compilation: { strict: true, noUncheckedIndexedAccess: true, noEmit: true, virtualWitnessHash }, toolchain: { node: process.version, typescript: ts.version, ajv: require('ajv/package.json').version }, checks, inputFiles: [...inputFiles].map(([relativePath, sha256]) => ({ relativePath, sha256 })), externalInputs: [...externalInputs].map(([reference, item]) => ({ reference, sha256: item.sha256 })), limitations: limits, ...(error ? { error } : {}) };
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  fs.writeFileSync(auditFile, JSON.stringify(result, null, 2) + '\n');
  return result;
};

try {
  resource('evaluation/check-architecture-v7.mjs');
  external(path.join(repository, 'package.json'));
  for (const moduleName of ['typescript', 'ajv']) {
    external(require.resolve(moduleName));
    external(require.resolve(moduleName + '/package.json'));
  }
  const policy = load('vnext/architecture-policy-v7.json');
  const registry = load('vnext/skills-v6/registry.design.json');
  const catalog = load('vnext/skill-catalog-v6.json');
  const prompts = load('vnext/skills-v6/prompt-map.json').prompts;
  const suite = load('evaluation/architecture-v7-cases.json');
  const sources = load('audit/architecture-sources-v7.json');
  const ajv = new Ajv({ allErrors: true, strict: true });
  for (const [name, schema, value] of [['architecture-policy', policySchema, policy], ['architecture-case-definitions', suiteSchema, suite], ['source-index', sourceSchema, sources]]) {
    const validate = ajv.compile(schema);
    verify('actual-ajv-schema:' + name, validate(value), { errors: validate.errors });
  }
  verify('preserved-catalog-and-registry-state', registry.designVersion === 'V6' && registry.activationState === 'design_only' && registry.baselineCommit === baselineCommit && catalog.designVersion === 'V6');
  const operationKeys = new Set(catalog.skills.flatMap(skill => skill.operations.map(operation => skill.id + '.' + operation.id)));
  const registrySkills = new Set(registry.skills.map(skill => skill.skillId));
  const registrations = new Map();
  for (const skill of registry.skills) {
    verify('retained-inactive-package:' + skill.skillId, skill.active === false);
    for (const operation of skill.operations) {
      const key = skill.skillId + '.' + operation.operationId + ':' + (operation.targetKind ?? '');
      verify('retained-unavailable-unique-binding:' + key, operation.adapter?.state === 'unavailable' && !registrations.has(key));
      registrations.set(key, operation);
    }
  }
  verify('retained-19-skills-48-operations-50-bindings', registry.skills.length === 19 && registrySkills.size === 19 && catalog.skills.length === 19 && operationKeys.size === 48 && registrations.size === 50);
  verify('same-catalog-skill-identities', same(sorted(registrySkills), sorted(catalog.skills.map(skill => skill.id))));
  verify('same-default-workflow-kinds', same(sorted(Object.keys(policy.workflowRouting.defaultOwners)), sorted(workflowKinds)));
  const owners = new Map();
  for (const [workflow, skills] of Object.entries(policy.workflowRouting.defaultOwners)) for (const skill of skills) {
    verify('one-default-workflow-owner:' + skill, registrySkills.has(skill) && !owners.has(skill));
    owners.set(skill, workflow);
  }
  verify('all-retained-skills-owned', same(sorted(owners.keys()), sorted(registrySkills)));
  const mapped = new Set();
  for (const binding of policy.operationBindings) {
    const pair = binding.skillId + '.' + binding.operationId;
    const key = pair + ':' + (binding.targetKind ?? '');
    const retained = registrations.get(key);
    verify('exact-inactive-workflow-binding:' + key, !mapped.has(key) && Boolean(retained) && operationKeys.has(pair) && binding.contextVariant === retained.runtimeCoreVariant && binding.defaultWorkflow === owners.get(binding.skillId) && binding.active === false && binding.adapter === 'unavailable');
    mapped.add(key);
  }
  verify('full-50-binding-bijection', same(sorted(mapped), sorted(registrations.keys())));
  verify('112-distinct-prompt-identities-and-paths', prompts.length === 112 && new Set(prompts.map(prompt => prompt.promptId)).size === 112 && new Set(prompts.map(prompt => prompt.path)).size === 112);
  for (const prompt of prompts) verify('retained-prompt-hash:' + prompt.promptId, /^[a-f0-9]{64}$/.test(prompt.sha256) && sha(resource(prompt.path)) === prompt.sha256);
  verify('policy-preserves-one-state-authority', policy.authority.commandReceipts === 'existing_operations' && policy.authority.capabilityDirectory === 'versioned_skill_registry' && policy.authority.taskExecution === 'existing_run_conversation_and_execution_records' && policy.authority.formalAdoption === 'existing_commit_kernel' && policy.authority.storyTruth === 'existing_versioned_canonical_store' && policy.taskContract.newCompetingTaskLedgerAllowed === false && policy.memoryScale.canonicalAuthorityCount === 1);
  verify('scope-and-contracts-reuse', policy.taskContract.hostOnly === true && policy.taskContract.policy === 'CreativeTaskPolicyV6' && policy.taskContract.base === 'WorkBaseV6' && policy.taskContract.readSet === 'ReadSetV3' && policy.taskContract.modelSerialization === 'compiled_model_payload_only' && same(policy.taskContract.readDependencyKinds, ['source', 'fact', 'artifact', 'predicate', 'absence']));
  verify('whole-request-and-feedback-isolation-declared', policy.context.privateProofModelVisible === false && policy.context.finalSerializedRequestInspectionRequired === true && policy.context.crossAudienceNativeSessionReuseAllowed === false && ['system_core', 'skill_method', 'operation', 'messages', 'tool_names_and_schemas', 'attachments_and_titles', 'retrieval_results', 'memory_and_summaries', 'prior_responses', 'provider_state', 'cache_namespace', 'repair_and_error_feedback'].every(surface => policy.context.isolationSurfaces.includes(surface)));
  verify('explicit-effects-and-host-recovery', policy.toolEffects.classification === 'explicit_host_verified_contract' && policy.toolEffects.namePrefixDefinesEffect === false && policy.toolEffects.modelCanonicalCommitAllowed === false && policy.toolEffects.frameworkAutomaticRetries === 0 && policy.toolEffects.retryOwner === 'existing_model_gateway' && policy.toolEffects.unknownWriteOutcome === 'no_automatic_reexecution');
  verify('core-same-version-and-optional-projections', policy.chapterClosure.coreCommit === 'prose_and_required_memory_same_revision' && policy.chapterClosure.requiresFinalProseHash === true && policy.chapterClosure.optionalProjectionFailureBlocksCommit === false && policy.projections.coreDataMayBeAsyncSkipped === false && policy.projections.newModelRequestForViewInteractions === false && policy.projections.semanticsEdit === 'candidate_changeset_then_existing_commit');
  const expectedActions = ['preserve_and_replay_existing_behaviors', 'extract_command_handlers_and_four_workflows', 'bind_versioned_tasks_and_context_policies', 'complete_one_chapter_core_closure', 'measure_and_optimize_long_book_updates', 'enable_v6_operations_individually_after_evidence'];
  verify('R0-through-R5-exact-order', same(policy.migrationOrder, expectedActions) && same(policy.migrationPhases, phaseIds.map((id, index) => ({ id, action: expectedActions[index] }))));
  const actualTierCounts = Object.fromEntries(tiers.map(tier => [tier, suite.cases.filter(item => item.tier === tier).length]));
  verify('24-unique-sequential-not-run-cases', same(suite.cases.map(item => item.id), Array.from({ length: 24 }, (_, index) => 'V7-A-' + String(index + 1).padStart(2, '0'))) && suite.cases.every(item => item.status === 'not_run' && item.executionCount === 0) && suite.executionCount === 0 && suite.coverage.executed === 0);
  verify('case-tier-counts-8-14-2', same(actualTierCounts, tierCountsExpected) && same(suite.coverage.byTier, tierCountsExpected));
  for (const item of suite.cases) verify('case-private-oracle:' + item.id, ['expected', 'oracle', 'secret_canaries', 'failure_injection', 'performance_thresholds', 'private_ground_truth'].every(key => item.oracle.mustNotReachModel.includes(key)));
  for (const inherited of suite.coverage.inheritedSuites) resource('evaluation/' + inherited);
  const officialUrls = ['https://github.com/earendil-works/pi/blob/main/packages/agent/README.md', 'https://docs.langchain.com/oss/javascript/langgraph/persistence', 'https://docs.langchain.com/oss/javascript/langgraph/interrupts', 'https://docs.temporal.io/production-deployment', 'https://docs.temporal.io/ai/featured/memory-state-stripe', 'https://www.anthropic.com/research/managed-agents'];
  const codeSources = sources.sources.filter(source => /^V7C/.test(source.id));
  const researchSources = sources.sources.filter(source => /^V7R/.test(source.id));
  verify('26-unique-source-identities', sources.sources.length === 26 && new Set(sources.sources.map(source => source.id)).size === 26 && new Set(sources.sources.map(source => source.url)).size === 26);
  verify('20-fixed-code-sources-and-six-official-sources', codeSources.length === 20 && researchSources.length === 6 && same(sorted(researchSources.map(source => source.url)), sorted(officialUrls)));
  for (const source of codeSources) {
    const url = new URL(source.url);
    verify('fixed-commit-code-url:' + source.id, url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith('/965896829/xingyue-shutai/blob/' + baselineCommit + '/') && url.search === '' && !url.username && !url.password);
  }
  const docs = ['design/agent-architecture-v7.md', 'design/current-architecture-audit-v7.md', 'design/implementation-backlog-v7.md', 'design/acceptance-protocol-v7.md', 'design/codex-handoff-v7.md', 'design/optimization-plan-v7.md'];
  const documents = new Map(docs.map(relative => [relative, text(relative)]));
  const phaseHeadings = [...documents.get('design/implementation-backlog-v7.md').matchAll(/^## (R[0-5])\s/gm)].map(match => match[1]);
  verify('backlog-phase-heading-order', same(phaseHeadings, phaseIds));
  for (const [relative, body] of documents) {
    verify('document-no-renderer-citation-tokens:' + relative, !/[\uE200-\uE2FF]/u.test(body));
    for (const match of body.matchAll(/https:\/\/[^\s)<>`]+/g)) {
      const raw = match[0].replace(/[.,;]+$/, '');
      const url = new URL(raw);
      if (url.hostname === 'github.com' && url.pathname.startsWith('/965896829/xingyue-shutai/blob/')) verify('document-fixed-code-reference:' + relative + ':' + url.pathname, url.pathname.startsWith('/965896829/xingyue-shutai/blob/' + baselineCommit + '/'));
    }
  }
  const contractPaths = fs.readdirSync(path.join(pack, 'vnext'), { withFileTypes: true }).filter(item => item.isFile() && item.name.endsWith('.ts')).map(item => 'vnext/' + item.name).sort();
  verify('ten-root-typescript-contract-files', contractPaths.length === 10 && contractPaths.includes('vnext/architecture-contracts-v7.ts'));
  const fullContracts = contractPaths.map(resource);
  const architectureText = fs.readFileSync(path.join(pack, 'vnext/architecture-contracts-v7.ts'), 'utf8');
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, architectureText);
  let commentCount = 0;
  let token;
  while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) commentCount += 1;
  verify('new-typescript-has-no-comments', commentCount === 0);
  const virtualPath = path.join(pack, 'vnext', '__architecture_v7_static_witness__.ts');
  const virtualSource = `import type { TaskSpecV7, TaskResultV7, CompiledTaskContextV7, CoreChapterCandidateV7, ExplicitToolContractV7, ProjectionBindingV7 } from './architecture-contracts-v7';
import type { CreativeTaskPolicyV6, CompiledScopedPacketV6, ReaderPrefixPayloadV6, CharacterTurnPayloadV6 } from './quality-creative-contracts-v6';
import type { ChapterMemoryDeltaV3 } from './character-mind-v3';
import type { ChapterMemoryBatchV3 } from './memory-contracts-v3';
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type ReusesAuthorPolicy = Assert<Equal<TaskSpecV7['policy'], CreativeTaskPolicyV6>>;
type TaskPrivate = Assert<Equal<TaskSpecV7['hostOnly'], true>>;
type PayloadOnly = Assert<Equal<TaskSpecV7['modelSerialization'], 'compiled_model_payload_only'>>;
type ReaderPacket = Assert<Equal<Extract<CompiledTaskContextV7, { runtimeCoreVariant: 'reader_prefix' }>['packet'], CompiledScopedPacketV6<ReaderPrefixPayloadV6>>>;
type ActorPacket = Assert<Equal<Extract<CompiledTaskContextV7, { runtimeCoreVariant: 'character_turn' }>['packet'], CompiledScopedPacketV6<CharacterTurnPayloadV6>>>;
type CoreMemory = Assert<Equal<CoreChapterCandidateV7['coreMemory'], ChapterMemoryDeltaV3>>;
type CoreCoverage = Assert<Equal<CoreChapterCandidateV7['coverageBatch'], ChapterMemoryBatchV3>>;
type NoTaskCommit = Assert<Equal<TaskResultV7['canonicalStateChanged'], false>>;
type NoToolCommit = Assert<Equal<ExplicitToolContractV7['canonicalCommitAllowed'], false>>;
type UnknownWritesStop = Assert<Equal<Extract<ExplicitToolContractV7, { effect: 'draft_write' | 'candidate_proposal' }>['unknownOutcome'], 'no_automatic_reexecution'>>;
type ProjectionNotCoreExtraction = Assert<Extract<ProjectionBindingV7['existingOutboxJob']['kind'], 'extract'> extends never ? true : false>;
type OptionalFailureIndependent = Assert<Equal<CoreChapterCandidateV7['optionalProjectionFailureBlocksCommit'], false>>;
`;
  virtualWitnessHash = shaBuffer(virtualSource);
  const options = { strict: true, noUncheckedIndexedAccess: true, noEmit: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, types: [] };
  const host = ts.createCompilerHost(options);
  const originalSource = host.getSourceFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  const originalRead = host.readFile.bind(host);
  host.fileExists = file => path.resolve(file) === virtualPath || originalExists(file);
  host.readFile = file => path.resolve(file) === virtualPath ? virtualSource : originalRead(file);
  host.getSourceFile = (file, language, onError, create) => path.resolve(file) === virtualPath ? ts.createSourceFile(file, virtualSource, language, true) : originalSource(file, language, onError, create);
  let emittedFiles = 0;
  host.writeFile = () => { emittedFiles += 1; throw new Error('noEmit contract violated'); };
  const program = ts.createProgram([...fullContracts, virtualPath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  for (const source of program.getSourceFiles()) if (path.resolve(source.fileName) !== virtualPath && !path.resolve(source.fileName).startsWith(pack + path.sep)) external(source.fileName);
  verify('strict-noUncheckedIndexedAccess-typescript', diagnostics.length === 0, { diagnostics: diagnostics.map(item => ({ code: item.code, file: item.file ? path.relative(pack, item.file.fileName) : null, message: ts.flattenDiagnosticMessageText(item.messageText, '\n') })) });
  verify('no-javascript-or-witness-file-emitted', emittedFiles === 0 && !fs.existsSync(virtualPath));
  verify('all-design-input-hashes-stable', [...inputFiles].every(([relative, digest]) => sha(path.join(pack, relative)) === digest));
  verify('all-toolchain-input-hashes-stable', [...externalInputs.values()].every(item => sha(item.file) === item.sha256));
  counts = { staticChecks: checks.length, typescriptContractFiles: contractPaths.length, virtualTypeWitnesses: 12, skills: registrySkills.size, operations: operationKeys.size, bindings: mapped.size, promptResources: prompts.length, architectureCaseDefinitions: suite.cases.length, architectureCaseTiers: actualTierCounts, architectureCasesExecuted: 0, migrationPhases: phaseIds, fixedCodeSources: codeSources.length, officialResearchSources: researchSources.length, hashedDesignInputFiles: inputFiles.size, hashedToolchainInputFiles: externalInputs.size };
  const result = emit('passed');
  process.stdout.write(JSON.stringify({ status: result.status, ...counts, runtimeIntegrationExecuted: false, modelCalls: 0 }) + '\n');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  emit('failed', message);
  process.stderr.write(message + '\n');
  process.exitCode = 1;
}
