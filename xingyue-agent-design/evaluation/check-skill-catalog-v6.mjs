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
const auditFile = path.join(pack, 'audit/skill-catalog-verification-v6.json');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hashText = value => crypto.createHash('sha256').update(value).digest('hex');
const sorted = values => [...values].sort();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const unique = values => [...new Set(values)];
const checks = [];
const inputFiles = new Map();
const limitations = ['Static design artifacts only; actual request assembly, tool execution, cache isolation and application behavior remain unverified.', 'All 40 scenario definitions remain not_executed; no local-contract behavior, model-output, app-integration or human-blind case was executed.', 'No model, provider, network research, paid call or reader recruitment is performed by this checker.', 'TypeScript conformance is not a runtime JSON schema for model tools; all adapters remain unavailable and inactive.', 'Candidate persistence contracts needing recursive projection are explicitly not directly serializable model output schemas.', 'Prompt Unicode codepoints exclude inputs, tool schemas and provider wrappers and are not token counts.', 'Static success does not establish literary quality, commercial success, million-character performance or production readiness.'];
let counts = {};
const verify = (name, condition, details = {}) => {
  checks.push({ name, passed: Boolean(condition), ...details });
  if (!condition) throw new Error(name);
};
const resourceFile = relative => {
  const file = path.resolve(pack, relative);
  verify('contained-existing-file:' + relative, !path.isAbsolute(relative) && file.startsWith(pack + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() && fs.realpathSync(file).startsWith(fs.realpathSync(pack) + path.sep));
  inputFiles.set(relative, sha(file));
  return file;
};
const text = relative => fs.readFileSync(resourceFile(relative), 'utf8');
const load = relative => JSON.parse(text(relative));
const walkFiles = root => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walkFiles(path.join(root, entry.name)) : [path.join(root, entry.name)]);
const emitAudit = result => {
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  fs.writeFileSync(auditFile, JSON.stringify(result, null, 2) + '\n');
};
const newOperations = ['co-creation.rehearse', 'chapter-draft.explore', 'voice-calibration.learn-edits', 'chapter-review.first-read', 'canon-audit.patterns', 'reader-feedback.compare'];
const corePaths = { author: 'runtime/agent.v6.md', reader_prefix: 'runtime/agent.reader-prefix.v6.md', character_turn: 'runtime/agent.character-turn.v6.md' };
const contractFiles = ['contracts.ts', 'co-creation-contracts.ts', 'memory-contracts-v3.ts', 'character-mind-v3.ts', 'skill-runtime-v4.ts', 'skill-runtime-v5.ts', 'world-contracts-v5.ts', 'skill-runtime-v6.ts', 'quality-creative-contracts-v6.ts'].map(name => 'vnext/' + name);
const stringSchema = { type: 'string', minLength: 1 };
const stringsSchema = { type: 'array', items: stringSchema };
const nonemptyStringsSchema = { type: 'array', minItems: 1, items: stringSchema };
const hashSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const refSchema = { type: 'object', additionalProperties: false, required: ['path', 'exportName'], properties: { path: stringSchema, exportName: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]*$' } } };
const nullableRefSchema = { anyOf: [refSchema, { type: 'null' }] };
const roleSchema = { type: 'object', additionalProperties: false, required: ['role', 'uses', 'bindingKind', 'declaredType', 'serialization', 'directObjectSerializationAllowed', 'runtimeSchemaState'], properties: { role: stringSchema, uses: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['input', 'output'] } }, bindingKind: { enum: ['declared_contract', 'adapter_logical_role'] }, declaredType: nullableRefSchema, serialization: { enum: ['host_private_never_send', 'scoped_payload_after_host_validation', 'model_result_only', 'explicit_projection_required', 'unavailable_until_adapter_defined'] }, directObjectSerializationAllowed: { type: 'boolean' }, runtimeSchemaState: { const: 'unavailable' } } };
const outputSchema = { type: 'object', additionalProperties: false, required: ['declaredBasisType', 'shapeMode', 'topLevelIncludedFields', 'hostOwnedFieldsExcludedOrRebound', 'runtimeSchemaState'], properties: { declaredBasisType: refSchema, shapeMode: { enum: ['dedicated_model_result', 'explicit_recursive_projection_required'] }, topLevelIncludedFields: stringsSchema, hostOwnedFieldsExcludedOrRebound: stringsSchema, runtimeSchemaState: { const: 'unavailable' } } };
const bindingSchema = { type: 'object', additionalProperties: false, required: ['bindingId', 'operation', 'targetKind', 'inputRoles', 'outputRole', 'runtimeCoreVariant', 'adapterState', 'modelInputMode', 'wholeInputObjectsSerialized', 'modelOutput', 'hostArtifactType', 'authority', 'scopeProofModelVisible', 'activationAllowed'], properties: { bindingId: stringSchema, operation: stringSchema, targetKind: { anyOf: [stringSchema, { type: 'null' }] }, inputRoles: nonemptyStringsSchema, outputRole: stringSchema, runtimeCoreVariant: { enum: ['author', 'reader_prefix', 'character_turn'] }, adapterState: { const: 'unavailable' }, modelInputMode: { enum: ['scoped_payload_only', 'host_compiled_author_projection'] }, wholeInputObjectsSerialized: { const: false }, modelOutput: { anyOf: [outputSchema, { type: 'null' }] }, hostArtifactType: nullableRefSchema, authority: { enum: ['candidate_only', 'retained_workflow_contract'] }, scopeProofModelVisible: { const: false }, activationAllowed: { const: false } } };
const mapSchema = { type: 'object', additionalProperties: false, required: ['designVersion', 'state', 'adapterState', 'serializationPolicy', 'contractRoleMeaning', 'newOutputBoundary', 'legacyRoleBoundary', 'initialWorkPolicy', 'qualityStatisticsPolicy', 'optionalAdjunctPolicy', 'runtimeValidationImplemented', 'contractResources', 'hostPrivateTypes', 'forbiddenWholeWrappers', 'roles', 'bindings', 'counts'], properties: { designVersion: { const: 'V6' }, state: { const: 'design_only' }, adapterState: { const: 'unavailable' }, serializationPolicy: { const: 'explicit_adapter_projection_required' }, contractRoleMeaning: stringSchema, newOutputBoundary: stringSchema, legacyRoleBoundary: stringSchema, initialWorkPolicy: stringSchema, qualityStatisticsPolicy: stringSchema, optionalAdjunctPolicy: stringSchema, runtimeValidationImplemented: { const: false }, contractResources: { type: 'array', minItems: 13, items: { type: 'object', additionalProperties: false, required: ['path', 'sha256'], properties: { path: stringSchema, sha256: hashSchema } } }, hostPrivateTypes: { type: 'array', items: refSchema }, forbiddenWholeWrappers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'exportName', 'allowedModelProperty', 'forbiddenModelProperty'], properties: { ...refSchema.properties, allowedModelProperty: { const: 'modelPayload' }, forbiddenModelProperty: { const: 'hostPrivateProof' } } } }, roles: { type: 'array', minItems: 1, items: roleSchema }, bindings: { type: 'array', minItems: 50, maxItems: 50, items: bindingSchema }, counts: { type: 'object', additionalProperties: false, required: ['skills', 'operations', 'bindings', 'logicalRoles', 'newOperationOutputMappings'], properties: { skills: { const: 19 }, operations: { const: 48 }, bindings: { const: 50 }, logicalRoles: { type: 'integer', minimum: 1 }, newOperationOutputMappings: { const: 6 } } } } };
const tiers = ['local_contract', 'app_integration', 'model_output', 'human_blind'];
const caseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'tier', 'feature', 'given', 'when', 'expected', 'requires', 'executionStatus'],
  properties: {
    id: { type: 'string', pattern: '^V6-Q-[0-9]{2}$' },
    tier: { enum: tiers }, feature: stringSchema,
    operation: { anyOf: [stringSchema, { type: 'null' }] },
    given: stringSchema, when: stringSchema, expected: nonemptyStringsSchema,
    requires: nonemptyStringsSchema, executionStatus: { const: 'not_executed' }
  }
};
const suiteSchema = {
  type: 'object', additionalProperties: false,
  required: ['designVersion', 'suiteId', 'createdAt', 'executionStatus', 'scope', 'executionGuidance', 'coverage', 'cases'],
  properties: {
    designVersion: { const: 'V6' }, suiteId: stringSchema, createdAt: stringSchema,
    executionStatus: { const: 'not_executed' }, scope: stringSchema,
    executionGuidance: { type: 'object', additionalProperties: stringSchema },
    coverage: {
      type: 'object', additionalProperties: false, required: ['total', 'byTier', 'newOperations', 'executed'],
      properties: {
        total: { const: 40 },
        byTier: { type: 'object', additionalProperties: false, required: tiers, properties: Object.fromEntries(tiers.map(tier => [tier, { type: 'integer', minimum: 0 }])) },
        newOperations: { ...nonemptyStringsSchema, uniqueItems: true }, executed: { const: 0 }
      }
    },
    cases: { type: 'array', minItems: 40, maxItems: 40, items: caseSchema }
  }
};

try {
  resourceFile('evaluation/check-skill-catalog-v6.mjs');
  const catalog = load('vnext/skill-catalog-v6.json');
  const catalogSchema = load('vnext/skill-catalog-v6.schema.json');
  const registry = load('vnext/skills-v6/registry.design.json');
  const mapper = load('vnext/skills-v6/contract-bindings.json');
  const suite = load('evaluation/quality-creative-v6-cases.json');
  const assembly = load('vnext/skills-v6/assembly-policy.json');
  const sizes = load('audit/skill-assembly-sizes-v6.json');
  const migration = load('vnext/skills-v6/migration-map.json');
  const ajv = new Ajv({ allErrors: true, strict: true });
  for (const [name, schema, data] of [['catalog', catalogSchema, catalog], ['contract-bindings', mapSchema, mapper], ['evaluation-definitions', suiteSchema, suite]]) {
    const validate = ajv.compile(schema);
    verify('actual-json-schema:' + name, validate(data), { errors: validate.errors });
  }
  const priorCatalog = load('vnext/skill-catalog-v5.json');
  const skills = new Map(catalog.skills.map(skill => [skill.id, skill]));
  const operations = new Map(catalog.skills.flatMap(skill => skill.operations.map(operation => [skill.id + '.' + operation.id, { skill, operation }])));
  verify('19-unique-skills-48-unique-operations', skills.size === 19 && catalog.skills.length === 19 && operations.size === 48 && catalog.skills.reduce((sum, skill) => sum + skill.operations.length, 0) === 48);
  verify('preserved-19-v5-skills', same(sorted(skills.keys()), sorted(priorCatalog.skills.map(skill => skill.id))));
  const priorOperations = new Set(priorCatalog.skills.flatMap(skill => skill.operations.map(operation => skill.id + '.' + operation.id)));
  verify('42-retained-six-new-operations', priorOperations.size === 42 && [...priorOperations].every(key => operations.has(key)) && same(sorted([...operations.keys()].filter(key => !priorOperations.has(key))), sorted(newOperations)));
  const promptMap = load('vnext/skills-v6/prompt-map.json').prompts;
  const priorPrompts = load('vnext/skills-v5/prompt-map.json').prompts;
  const prompts = new Map(promptMap.map(prompt => [prompt.promptId, prompt]));
  verify('112-unique-prompt-resources', promptMap.length === 112 && prompts.size === 112);
  verify('34-new-prompt-identities', same(sorted(promptMap.filter(prompt => /^V6P/.test(prompt.promptId)).map(prompt => prompt.promptId)), Array.from({ length: 34 }, (_, index) => 'V6P' + String(index + 1).padStart(2, '0'))));
  verify('78-retained-prompt-resource-bytes', priorPrompts.length === 78 && priorPrompts.every(prompt => prompts.get(prompt.promptId)?.path === prompt.path && prompts.get(prompt.promptId)?.sha256 === prompt.sha256 && same(prompts.get(prompt.promptId)?.usedBySkillIds, prompt.usedBySkillIds)));
  for (const prompt of promptMap) verify('prompt-content-hash:' + prompt.promptId, sha(resourceFile(prompt.path)) === prompt.sha256);
  verify('three-active-core-variants', same(sorted(promptMap.filter(prompt => prompt.classification === 'active_core_variant').map(prompt => prompt.path)), sorted(Object.values(corePaths))));
  for (const skill of catalog.skills) verify('valid-source-prompt-ids:' + skill.id, [...skill.sourcePromptIds, ...skill.operations.flatMap(operation => operation.sourcePromptIds)].every(id => prompts.has(id)));
  verify('registry-design-only', registry.manifestSchemaVersion === 2 && registry.designVersion === 'V6' && registry.activationState === 'design_only' && registry.baselineCommit === 'b505f6f459db74871f39f63acf6106b827c8a353' && registry.skills.length === 19 && new Set(registry.skills.map(skill => skill.skillId)).size === 19);
  verify('assembly-single-core-method-operation', assembly.id === 'v6-single-core-method-operation' && assembly.designVersion === 'V6' && assembly.state === 'design_only' && assembly.sourcePromptIdsUse === 'trace_only_not_injected' && assembly.hostPrivateProofSentToModel === false && same(assembly.composition, ['selected_runtime_core', 'selected_method_replaces_default', 'one_operation', 'host_filtered_task_context', 'actual_output_contract']) && same(sorted(assembly.newOperations), sorted(newOperations)));
  verify('isolation-surface-declaration', same(sorted(assembly.scopedIsolationSurfaces), sorted(['system', 'method', 'operation', 'messages', 'tool_schema', 'attachment_names', 'history', 'retrieval', 'cache', 'provider_session', 'error_feedback'])));
  const assemblyByOperation = new Map(assembly.operations.map(item => [item.operation, item]));
  const sizeByOperation = new Map(sizes.operations.map(item => [item.operation, item]));
  verify('assembly-and-size-coverage', assembly.operations.length === 48 && assemblyByOperation.size === 48 && sizes.operations.length === 48 && sizeByOperation.size === 48 && [...operations.keys()].every(key => assemblyByOperation.has(key) && sizeByOperation.has(key)));
  const registrations = new Map();
  const boundOperations = new Set();
  const instructionResources = new Set();
  for (const skill of registry.skills) {
    const blueprint = skills.get(skill.skillId);
    verify('inactive-builtin-package:' + skill.skillId, Boolean(blueprint) && skill.active === false && skill.provenance === 'builtin' && skill.manifestSchemaVersion === 2 && skill.skillVersion === '6.0.0-design');
    const entryText = text(skill.entryTemplate);
    verify('entry-content-hash:' + skill.skillId, hashText(entryText) === skill.entrySha256);
    const frontmatter = entryText.match(/^---\nname: ([a-z0-9-]+)\nversion: 6\.0\.0-design\ndescription: (.+)\n---\n/);
    verify('entry-frontmatter-and-method:' + skill.skillId, Boolean(frontmatter) && frontmatter[1] === skill.skillId && JSON.parse(frontmatter[2]) === blueprint.description && entryText.includes(blueprint.coreInstructions) && entryText.split('\n').length < 500);
    for (const registered of skill.operations) {
      const pair = skill.skillId + '.' + registered.operationId;
      const key = pair + ':' + (registered.targetKind ?? '');
      verify('unique-operation-binding:' + key, !registrations.has(key) && operations.has(pair));
      registrations.set(key, registered);
      boundOperations.add(pair);
      const original = operations.get(pair).operation;
      const target = (original.targetBindings ?? []).find(binding => binding.targetKind === registered.targetKind);
      verify('target-route:' + key, registered.targetKind === undefined ? (original.targetBindings ?? []).length === 0 : target !== undefined);
      verify('exact-input-output-validator-binding:' + key, same(registered.inputKinds, unique([...original.inputKinds, ...(target?.additionalInputKinds ?? [])])) && registered.outputKind === original.outputKind && same(registered.validatorIds, unique([...original.validators, ...(target?.additionalValidators ?? [])])) && same(registered.requestedCapabilities, original.capabilitiesRequested) && registered.contextView === original.contextView && registered.provenanceBinding === original.outputBinding);
      verify('adapter-unavailable-budget-workflow:' + key, registered.adapter.state === 'unavailable' && same(registered.workflowVersions, ['v6-proposed']) && registered.budgetPolicyId === 'host-task-budget');
      verify('single-selected-operation-resource:' + key, registered.resources.length === 1 && registered.resources[0].resourceId === pair);
      for (const resource of [...registered.resources, registered.runtimeCoreResource, registered.methodResource]) verify('selected-resource-hash:' + key + ':' + resource.resourceId, resource.kind === 'instructions' && resource.use === 'required' && sha(resourceFile(resource.relativePath)) === resource.sha256);
      const operationResource = registered.resources[0];
      instructionResources.add(operationResource.relativePath);
      verify('operation-resource-text:' + key, text(operationResource.relativePath) === '# ' + original.title + '\n\n' + original.instructions + '\n');
      const replacement = typeof original.coreInstructionsOverride === 'string';
      const methodExpected = replacement ? '# ' + original.title + '共同方法\n\n' + original.coreInstructionsOverride + '\n' : '# ' + blueprint.title + '\n\n' + blueprint.coreInstructions + '\n';
      verify('core-method-replacement:' + key, registered.runtimeCoreVariant === original.runtimeCoreVariant && registered.runtimeCoreResource.relativePath === corePaths[original.runtimeCoreVariant] && registered.runtimeCoreResource.resourceId === 'core.' + original.runtimeCoreVariant && registered.methodSelection === (replacement ? 'operation_replacement' : 'skill_default') && text(registered.methodResource.relativePath) === methodExpected && registered.assemblyPolicyId === assembly.id);
      const selected = [registered.runtimeCoreResource.relativePath, registered.methodResource.relativePath, operationResource.relativePath];
      const row = assemblyByOperation.get(pair);
      verify('assembly-row-binding:' + key, same(row.selectedResources, selected) && row.runtimeCoreVariant === original.runtimeCoreVariant && row.methodSelection === registered.methodSelection && row.contextView === original.contextView && same(row.requestedCapabilities, registered.requestedCapabilities));
      const size = sizeByOperation.get(pair);
      verify('measured-literal-resource-size:' + key, same(size.sourcePaths, selected) && size.runtimeCoreVariant === original.runtimeCoreVariant && size.unicodeCodepoints === selected.reduce((sum, relative) => sum + [...text(relative)].length, 0) && same(size.excludes, ['task inputs', 'tool schemas', 'provider wrappers', 'optional references']));
    }
    const packageRoot = path.dirname(path.join(pack, skill.entryTemplate));
    const digestInput = sorted(walkFiles(packageRoot)).map(file => [path.relative(pack, file), sha(resourceFile(path.relative(pack, file)))]);
    verify('package-content-digest:' + skill.skillId, hashText(JSON.stringify(digestInput)) === skill.packageDigest);
  }
  verify('50-bindings-48-operation-resources', registrations.size === 50 && boundOperations.size === 48 && instructionResources.size === 48 && [...operations.keys()].every(key => boundOperations.has(key)));
  for (const pair of newOperations) verify('new-operation-candidate-submit-only:' + pair, same(operations.get(pair).operation.capabilitiesRequested, ['candidate.submit']) && operations.get(pair).operation.outputBinding === 'v6_adapter_required');
  for (const [pair, variant, inputs] of [['chapter-review.first-read', 'reader_prefix', ['ReaderPrefixPacketV6', 'FirstReadTaskV6']], ['co-creation.rehearse', 'character_turn', ['CharacterTurnPacketV6', 'CharacterTurnTaskPolicyV6']]]) {
    const operation = operations.get(pair).operation;
    const row = assemblyByOperation.get(pair);
    const ordinary = operations.get(pair).skill.coreInstructions;
    verify('scoped-core-and-method-not-author-concatenation:' + pair, operation.runtimeCoreVariant === variant && same(operation.inputKinds, inputs) && row.methodSelection === 'operation_replacement' && row.selectedResources[0] !== corePaths.author && row.selectedResources.every(relative => !relative.endsWith('/references/_method.md')) && !text(row.selectedResources[1]).includes(ordinary));
  }
  verify('only-two-scoped-variants', same(sorted([...operations].filter(([, value]) => value.operation.runtimeCoreVariant !== 'author').map(([key]) => key)), ['chapter-review.first-read', 'co-creation.rehearse']));
  const packaging = [...registrations].filter(([key]) => key.startsWith('packaging.review:'));
  verify('packaging-three-targets', same(sorted(packaging.map(([, value]) => value.targetKind)), ['blurb', 'book_title', 'entity_name']) && [...registrations].every(([key, value]) => value.targetKind === undefined || key.startsWith('packaging.review:')));
  const entityReview = registrations.get('packaging.review:entity_name');
  const titleReview = registrations.get('packaging.review:book_title');
  const blurbReview = registrations.get('packaging.review:blurb');
  verify('packaging-target-dependency-separation', ['TitleEvidenceSnapshotV5', 'PublicationPromiseV5', 'PackagingStoryContextV5'].every(name => !entityReview.inputKinds.includes(name) && titleReview.inputKinds.includes(name)) && ['PublicationPromiseV5', 'PackagingStoryContextV5'].every(name => blurbReview.inputKinds.includes(name)) && !blurbReview.inputKinds.includes('TitleEvidenceSnapshotV5'));
  verify('migration-keeps-frozen-tasks', migration.designVersion === 'V6' && migration.previousDesignVersion === 'V5' && migration.taskPolicy === 'frozen_tasks_keep_original_resources_and_contracts' && same(sorted(migration.newOperations), sorted(newOperations)) && migration.inputRoleAliases.ReaderExperienceSliceV6 === 'ReadingExperienceProjectionV6');
  verify('size-minimum-and-maximum', sizes.minimum === Math.min(...sizes.operations.map(item => item.unicodeCodepoints)) && sizes.maximum === Math.max(...sizes.operations.map(item => item.unicodeCodepoints)));
  const tierCounts = Object.fromEntries(tiers.map(tier => [tier, suite.cases.filter(item => item.tier === tier).length]));
  verify('40-unique-unexecuted-definitions', new Set(suite.cases.map(item => item.id)).size === 40 && suite.cases.every(item => item.executionStatus === 'not_executed' && (item.operation == null || operations.has(item.operation))) && suite.coverage.executed === 0);
  verify('four-evaluation-tiers', same(tierCounts, { local_contract: 14, app_integration: 9, model_output: 11, human_blind: 6 }) && same(tierCounts, suite.coverage.byTier) && same(sorted(suite.coverage.newOperations), sorted(newOperations)) && newOperations.every(pair => suite.cases.some(item => item.operation === pair)));
  const exportNames = new Map();
  const sourceFiles = new Map();
  for (const relative of contractFiles) {
    const source = ts.createSourceFile(relative, text(relative), ts.ScriptTarget.Latest, true);
    sourceFiles.set(relative, source);
    exportNames.set(relative, new Set(source.statements.filter(node => node.name && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).map(node => node.name.text)));
  }
  const allRefs = [...mapper.roles.flatMap(role => role.declaredType ? [role.declaredType] : []), ...mapper.hostPrivateTypes, ...mapper.forbiddenWholeWrappers, ...mapper.bindings.flatMap(binding => [binding.modelOutput?.declaredBasisType, binding.hostArtifactType].filter(Boolean))];
  for (const reference of allRefs) verify('declared-type-export:' + reference.path + '#' + reference.exportName, exportNames.get(reference.path)?.has(reference.exportName));
  const actualRoles = sorted(unique([...registrations.values()].flatMap(binding => [...binding.inputKinds, binding.outputKind])));
  const mappedRoles = new Map(mapper.roles.map(role => [role.role, role]));
  verify('every-logical-role-mapped-once', mapper.roles.length === mappedRoles.size && same(sorted(mappedRoles.keys()), actualRoles) && mapper.counts.logicalRoles === actualRoles.length);
  const safeInputRoles = ['ReaderPrefixPacketV6', 'CharacterTurnPacketV6', 'FirstReadTaskV6', 'CharacterTurnTaskPolicyV6'];
  verify('no-implicit-legacy-or-host-serialization', mapper.roles.every(role => role.bindingKind === 'adapter_logical_role' ? role.declaredType === null && role.serialization === 'unavailable_until_adapter_defined' && role.directObjectSerializationAllowed === false : role.declaredType.exportName === role.role) && same(sorted(mapper.roles.filter(role => role.directObjectSerializationAllowed).map(role => role.role)), sorted(safeInputRoles)));
  const expectedPrivate = ['WorkBaseV6', 'ExplorationBranchV6', 'CandidatePromotionRequestV6', 'CandidatePromotionReceiptV6', 'PrivateContextSurfaceAuditV6', 'PrivateScopedContextProofV6', 'PrivateBlindPresentationBindingV6', 'QualityRunRecordV6', 'QualityComparisonHostSnapshotV6', 'QualityComparisonAssemblyReceiptV6', 'NarrativeSubmissionValidationReceiptV6', 'PreferenceActivationV6', 'ReadSetV3'];
  verify('host-private-records-not-model-inputs', same(sorted(mapper.hostPrivateTypes.map(item => item.exportName)), sorted(expectedPrivate)) && expectedPrivate.every(name => !mappedRoles.has(name) || mappedRoles.get(name).serialization === 'host_private_never_send') && mapper.forbiddenWholeWrappers.length === 1 && mapper.forbiddenWholeWrappers[0].exportName === 'CompiledScopedPacketV6');
  const mappedBindings = new Map(mapper.bindings.map(binding => [binding.bindingId, binding]));
  verify('50-exact-mapped-binding-identities', mappedBindings.size === 50 && same(sorted(mappedBindings.keys()), sorted(registrations.keys())));
  const outputNames = { 'co-creation.rehearse': ['CharacterRehearsalModelResultV6', 'CharacterRehearsalTurnV6'], 'chapter-draft.explore': ['ExplorationDraftV6', 'ExplorationDraftV6'], 'voice-calibration.learn-edits': ['PreferenceLearningCandidatesV6', 'PreferenceLearningCandidatesV6'], 'chapter-review.first-read': ['FirstReadModelResultV6', 'FirstReadReportV6'], 'canon-audit.patterns': ['PatternComparisonV6', 'PatternComparisonV6'], 'reader-feedback.compare': ['QualityComparisonModelResultV6', 'QualityComparisonReportV6'] };
  for (const [key, binding] of mappedBindings) {
    const registered = registrations.get(key);
    const special = outputNames[binding.operation];
    verify('mapper-registration-contract:' + key, same(binding.inputRoles, registered.inputKinds) && binding.outputRole === registered.outputKind && binding.runtimeCoreVariant === registered.runtimeCoreVariant && binding.targetKind === (registered.targetKind ?? null) && binding.operation === key.slice(0, key.lastIndexOf(':')));
    verify('mapper-candidate-or-legacy-output:' + key, special ? binding.modelOutput?.declaredBasisType.exportName === special[0] && binding.hostArtifactType?.exportName === special[1] && binding.authority === 'candidate_only' : binding.modelOutput === null && binding.hostArtifactType === null && binding.authority === 'retained_workflow_contract');
    verify('mapper-scoped-view-mode:' + key, binding.modelInputMode === (binding.runtimeCoreVariant === 'author' ? 'host_compiled_author_projection' : 'scoped_payload_only'));
  }
  verify('three-dedicated-model-results-three-recursive-projections', mapper.bindings.filter(binding => binding.modelOutput?.shapeMode === 'dedicated_model_result').length === 3 && mapper.bindings.filter(binding => binding.modelOutput?.shapeMode === 'explicit_recursive_projection_required').length === 3 && mapper.bindings.filter(binding => binding.modelOutput?.shapeMode === 'explicit_recursive_projection_required').every(binding => binding.modelOutput.topLevelIncludedFields.length > 0 && binding.modelOutput.hostOwnedFieldsExcludedOrRebound.length > 0));
  for (const resource of mapper.contractResources) verify('mapper-bound-resource-hash:' + resource.path, sha(resourceFile(resource.path)) === resource.sha256);
  verify('mapper-binds-nine-contracts-and-own-checker', contractFiles.every(relative => mapper.contractResources.some(resource => resource.path === relative)) && mapper.contractResources.some(resource => resource.path === 'evaluation/check-skill-catalog-v6.mjs'));
  const options = { strict: true, noUncheckedIndexedAccess: true, noEmit: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, types: [] };
  const distinctRefs = [...new Map(allRefs.filter(reference => reference.exportName !== 'CompiledScopedPacketV6').map(reference => [reference.path + '#' + reference.exportName, reference])).values()];
  const refUnion = distinctRefs.map(reference => JSON.stringify(reference.path + '#' + reference.exportName)).join(' | ');
  const typeWitnesses = distinctRefs.map((reference, index) => 'type DeclaredReference' + index + ' = import(' + JSON.stringify('./' + path.basename(reference.path, '.ts')) + ').' + reference.exportName + ';').join('\n');
  const projectionWitnesses = mapper.bindings.filter(binding => binding.modelOutput?.shapeMode === 'explicit_recursive_projection_required').map((binding, index) => 'type ProjectionFields' + index + ' = Pick<import("./quality-creative-contracts-v6").' + binding.modelOutput.declaredBasisType.exportName + ', ' + binding.modelOutput.topLevelIncludedFields.map(JSON.stringify).join(' | ') + '>;').join('\n');
  const virtualSource = `import type { SkillCatalogBlueprintV6, SkillRegistryDesignV6 } from './skill-runtime-v6';
import type { ReaderPrefixPacketV6, CharacterTurnPacketV6, CharacterRehearsalModelResultV6, FirstReadModelResultV6, FirstReadFindingModelV6, QualityComparisonModelResultV6, QualityComparisonHostSnapshotV6, WorkBaseV6, CreativeTaskPolicyV6, NarrativeSubmissionValidationReceiptV6, PrivateScopedContextProofV6, CompiledScopedPacketV6 } from './quality-creative-contracts-v6';
type Assert<T extends true> = T;
type TypeReference = { path: string; exportName: string };
type ModelOutput = { declaredBasisType: TypeReference; shapeMode: 'dedicated_model_result' | 'explicit_recursive_projection_required'; topLevelIncludedFields: string[]; hostOwnedFieldsExcludedOrRebound: string[]; runtimeSchemaState: 'unavailable' };
type ContractBindingMap = { designVersion: 'V6'; state: 'design_only'; adapterState: 'unavailable'; serializationPolicy: 'explicit_adapter_projection_required'; contractRoleMeaning: string; newOutputBoundary: string; legacyRoleBoundary: string; initialWorkPolicy: string; qualityStatisticsPolicy: string; optionalAdjunctPolicy: string; runtimeValidationImplemented: false; contractResources: { path: string; sha256: string }[]; hostPrivateTypes: TypeReference[]; forbiddenWholeWrappers: (TypeReference & { allowedModelProperty: 'modelPayload'; forbiddenModelProperty: 'hostPrivateProof' })[]; roles: { role: string; uses: ('input' | 'output')[]; bindingKind: 'declared_contract' | 'adapter_logical_role'; declaredType: TypeReference | null; serialization: 'host_private_never_send' | 'scoped_payload_after_host_validation' | 'model_result_only' | 'explicit_projection_required' | 'unavailable_until_adapter_defined'; directObjectSerializationAllowed: boolean; runtimeSchemaState: 'unavailable' }[]; bindings: { bindingId: string; operation: string; targetKind: string | null; inputRoles: string[]; outputRole: string; runtimeCoreVariant: 'author' | 'reader_prefix' | 'character_turn'; adapterState: 'unavailable'; modelInputMode: 'scoped_payload_only' | 'host_compiled_author_projection'; wholeInputObjectsSerialized: false; modelOutput: ModelOutput | null; hostArtifactType: TypeReference | null; authority: 'candidate_only' | 'retained_workflow_contract'; scopeProofModelVisible: false; activationAllowed: false }[]; counts: { skills: 19; operations: 48; bindings: 50; logicalRoles: number; newOperationOutputMappings: 6 } };
type Tier = 'local_contract' | 'app_integration' | 'model_output' | 'human_blind';
type EvaluationSuite = { designVersion: 'V6'; suiteId: string; createdAt: string; executionStatus: 'not_executed'; scope: string; executionGuidance: Record<string, string>; coverage: { total: 40; byTier: Record<Tier, number>; newOperations: string[]; executed: 0 }; cases: { id: string; tier: Tier; feature: string; operation?: string | null; given: string; when: string; expected: [string, ...string[]]; requires: [string, ...string[]]; executionStatus: 'not_executed' }[] };
const catalog: SkillCatalogBlueprintV6 = ${JSON.stringify(catalog)};
const registry: SkillRegistryDesignV6 = ${JSON.stringify(registry)};
const bindings: ContractBindingMap = ${JSON.stringify(mapper)};
const suite: EvaluationSuite = ${JSON.stringify(suite)};
type VerifiedReferenceKey = ${refUnion};
const references: VerifiedReferenceKey[] = ${JSON.stringify(distinctRefs.map(reference => reference.path + '#' + reference.exportName))};
${typeWitnesses}
${projectionWitnesses}
type ReaderSourceKinds = Assert<ReaderPrefixPacketV6['sources'][number]['kind'] extends 'prose' | 'visible_heading' | 'presented_title' | 'presented_blurb' ? true : false>;
type ActorSourceKinds = Assert<CharacterTurnPacketV6['sources'][number]['kind'] extends 'actor_observation' | 'actor_belief' | 'actor_expression' ? true : false>;
type ActorNoTruthVerdict = Assert<Extract<keyof CharacterTurnPacketV6, 'authorTruth' | 'beliefTruth' | 'fullAuthorContract' | 'hostPrivateProof'> extends never ? true : false>;
type ReaderNoPrivateProof = Assert<Extract<keyof ReaderPrefixPacketV6, 'hostPrivateProof' | 'readSet' | 'base' | 'authorContract'> extends never ? true : false>;
type ActorNoPrivateProof = Assert<Extract<keyof CharacterRehearsalModelResultV6, 'contextRequestHash' | 'policyVersion' | 'turnVersion'> extends never ? true : false>;
type FirstReadNoPersistedFindingId = Assert<'id' extends keyof FirstReadFindingModelV6 ? false : true>;
type FirstReadNoPrivateHash = Assert<Extract<keyof Extract<FirstReadModelResultV6, { state: 'ready' }>, 'packetId' | 'requestHash' | 'readSet'> extends never ? true : false>;
type ComparisonConclusionsOnly = Assert<Exclude<keyof QualityComparisonModelResultV6, 'conclusions' | 'proposedNextExperiment'> extends never ? true : false>;
type HostStatisticsPresent = Assert<'strata' | 'includedObservationIds' | 'excludedObservations' | 'hostStatisticsHash' extends keyof QualityComparisonHostSnapshotV6 ? true : false>;
type InitialWorkWithoutAcceptedProse = Assert<Extract<WorkBaseV6, { kind: 'initial_work' }>['acceptedProse'] extends false ? true : false>;
type AuthorContractVersionRequired = Assert<{} extends Pick<CreativeTaskPolicyV6, 'authorContractVersion'> ? false : true>;
type HostProofPrivate = Assert<PrivateScopedContextProofV6['modelVisible'] extends false ? true : false>;
type ScopedPayload = CompiledScopedPacketV6<ReaderPrefixPacketV6 | CharacterTurnPacketV6>;
type SidebandIndependentCore = Extract<NarrativeSubmissionValidationReceiptV6, { coreDisposition: 'continue_existing_core_workflow' }>;
type InvalidAdjunctAllowed = Assert<{ state: 'invalid'; rawPayloadHash: null; validatedPayloadHash: null; projectionCandidateId: null; reasonCodes: ['bad'] } extends SidebandIndependentCore['adjuncts']['readingExperience'] ? true : false>;
void [catalog, registry, bindings, suite, references];
`;
  const virtualFile = path.join(pack, 'vnext/validation-v6.virtual.ts');
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => path.resolve(file) === virtualFile ? ts.createSourceFile(file, virtualSource, languageVersion, true) : originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([...contractFiles.map(resourceFile), virtualFile], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  verify('typescript-strict-nine-contracts-actual-json-and-boundary-witnesses', diagnostics.length === 0, { version: ts.version, strict: true, noUncheckedIndexedAccess: true, contractFiles, actualJsonAssignments: ['vnext/skill-catalog-v6.json', 'vnext/skills-v6/registry.design.json', 'vnext/skills-v6/contract-bindings.json', 'evaluation/quality-creative-v6-cases.json'], boundaryWitnesses: ['reader-visible-source-kinds', 'character-belief-without-truth-verdict', 'scoped-output-without-private-hashes', 'first-read-finding-id-assigned-by-host', 'comparison-conclusion-only', 'host-owned-statistics', 'initial-work-with-initialized-author-contract', 'optional-invalid-adjunct-with-valid-core', 'candidate-projection-fields-exist'], diagnostics: diagnostics.map(diagnostic => ({ file: diagnostic.file ? path.relative(pack, diagnostic.file.fileName) : null, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') })) });
  for (const relative of [...contractFiles, 'evaluation/check-skill-catalog-v6.mjs']) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text(relative));
    let token;
    let comments = 0;
    while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) comments += 1;
    verify('code-has-no-comments:' + relative, comments === 0);
  }
  verify('mapper-and-checker-hashes-tracked', inputFiles.has('vnext/skills-v6/contract-bindings.json') && inputFiles.has('evaluation/check-skill-catalog-v6.mjs'));
  verify('all-input-files-stable-during-check', [...inputFiles].every(([relative, digest]) => sha(path.join(pack, relative)) === digest));
  counts = { skills: 19, operations: 48, bindings: 50, promptResources: 112, preservedV5PromptResources: 78, addedV6PromptResources: 34, mappedLogicalRoles: mapper.roles.length, newOperationOutputMappings: 6, typescriptContractFiles: 9, evaluationCases: 40, evaluationCasesExecuted: 0, evaluationTiers: tierCounts, promptBodyUnicodeCodepoints: { minimum: sizes.minimum, maximum: sizes.maximum }, coreUnicodeCodepoints: Object.fromEntries(Object.entries(corePaths).map(([variant, relative]) => [variant, [...text(relative)].length])) };
  const result = { designVersion: 'V6', status: 'passed', scope: 'static design-artifact verification only', checkedAt: new Date().toISOString(), ...counts, checks, inputFiles: [...inputFiles].map(([relativePath, sha256]) => ({ relativePath, sha256 })), checkerSha256: sha(checkerFile), contractBindingsSha256: sha(path.join(pack, 'vnext/skills-v6/contract-bindings.json')), limitations };
  emitAudit(result);
  process.stdout.write(JSON.stringify({ status: result.status, checks: checks.length, hashedInputFiles: inputFiles.size, ...counts }) + '\n');
} catch (error) {
  emitAudit({ designVersion: 'V6', status: 'failed', scope: 'static design-artifact verification only', checkedAt: new Date().toISOString(), ...counts, evaluationCasesExecuted: 0, checks, inputFiles: [...inputFiles].map(([relativePath, sha256]) => ({ relativePath, sha256 })), checkerSha256: sha(checkerFile), error: error instanceof Error ? error.message : String(error), limitations });
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
}
