import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const repositoryIndex = args.indexOf('--repository');
if (repositoryIndex === -1 || !args[repositoryIndex + 1]) throw new Error('--repository is required');
const repository = path.resolve(args[repositoryIndex + 1]);
const require = createRequire(path.join(repository, 'package.json'));
const Ajv = require('ajv');
const ts = require('typescript');
const pack = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditDirectory = path.join(pack, 'audit');
const read = relative => JSON.parse(fs.readFileSync(path.join(pack, relative), 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hashText = text => crypto.createHash('sha256').update(text).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sorted = values => [...values].sort();
const codepoints = text => [...text].length;
const pythonJson = value => Array.isArray(value) ? '[' + value.map(pythonJson).join(', ') + ']' : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ': ' + pythonJson(value[key])).join(', ') + '}' : JSON.stringify(value);
const checks = [];
const inputFiles = new Map();
const limitations = ['Static design-artifact checks only; no application integration', 'No model-output, local-host behavior or reader-blind cases executed', 'No paid model calls or public-network research executed by this checker', 'Prompt-body character counts are not token counts or full-request sizes', 'Schema and type conformance do not establish creative quality, runtime correctness or production completeness'];
let counts = {};
const verify = (name, condition, details = {}) => {
  checks.push({ name, passed: Boolean(condition), ...details });
  if (!condition) throw new Error(name);
};
const resourceFile = relative => {
  const resolved = path.resolve(pack, relative);
  verify('path-contained-' + relative, !path.isAbsolute(relative) && resolved.startsWith(pack + path.sep));
  verify('file-present-' + relative, fs.existsSync(resolved) && fs.statSync(resolved).isFile());
  verify('realpath-contained-' + relative, fs.realpathSync(resolved).startsWith(fs.realpathSync(pack) + path.sep));
  inputFiles.set(relative, sha(resolved));
  return resolved;
};
const load = relative => {
  resourceFile(relative);
  return read(relative);
};
const writeAudit = result => {
  fs.mkdirSync(auditDirectory, { recursive: true });
  fs.writeFileSync(path.join(auditDirectory, 'skill-catalog-verification-v5.json'), JSON.stringify(result, null, 2) + '\n');
};

try {
  const catalog = load('vnext/skill-catalog-v5.json');
  const schema = load('vnext/skill-catalog-v5.schema.json');
  const priorCatalog = load('vnext/skill-catalog-v4.json');
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  verify('catalog-json-schema', validate(catalog), { errors: validate.errors });
  const byId = new Map(catalog.skills.map(skill => [skill.id, skill]));
  verify('skill-count-and-unique-ids', catalog.skills.length === 19 && byId.size === 19);
  verify('preserved-v4-skill-packages', same(sorted(byId.keys()), sorted(priorCatalog.skills.map(skill => skill.id))));
  const pairs = new Map();
  for (const skill of catalog.skills) {
    verify('unique-operations-' + skill.id, new Set(skill.operations.map(operation => operation.id)).size === skill.operations.length);
    for (const operation of skill.operations) pairs.set(skill.id + '.' + operation.id, operation);
  }
  verify('operation-count', pairs.size === 42);
  const priorPairs = new Set(priorCatalog.skills.flatMap(skill => skill.operations.map(operation => skill.id + '.' + operation.id)));
  verify('preserved-v4-operations', priorPairs.size === 39 && [...priorPairs].every(pair => pairs.has(pair)));
  verify('only-three-world-operations-added', same(sorted([...pairs.keys()].filter(pair => !priorPairs.has(pair))), ['world-design.inherit', 'world-design.profile', 'world-design.stress-test']));

  const promptMap = load('vnext/skills-v5/prompt-map.json').prompts;
  const priorPrompts = load('vnext/skills-v4/prompt-map.json').prompts;
  const promptById = new Map(promptMap.map(prompt => [prompt.promptId, prompt]));
  verify('provenance-resource-count-and-unique-ids', promptMap.length === 78 && promptById.size === 78);
  verify('v4-provenance-resource-count', priorPrompts.length === 57);
  for (const prompt of priorPrompts) verify('preserved-v4-provenance-' + prompt.promptId, same(promptById.get(prompt.promptId), prompt));
  const addedPromptIds = promptMap.filter(prompt => /^V5P/.test(prompt.promptId)).map(prompt => prompt.promptId);
  verify('v5-provenance-resource-ids', same(sorted(addedPromptIds), Array.from({ length: 21 }, (_, index) => 'V5P' + String(index + 1).padStart(2, '0'))));
  for (const prompt of promptMap) verify('source-hash-' + prompt.promptId, sha(resourceFile(prompt.path)) === prompt.sha256);
  verify('v5-core-resource', promptById.get('V5P01')?.path === 'runtime/agent.v5.md' && promptById.get('V5P01')?.classification === 'current_core');
  for (const skill of catalog.skills) {
    const sourceIds = [...skill.sourcePromptIds, ...skill.operations.flatMap(operation => operation.sourcePromptIds)];
    verify('source-ids-' + skill.id, sourceIds.every(id => promptById.has(id)));
  }

  const registry = load('vnext/skills-v5/registry.design.json');
  verify('registry-version', registry.manifestSchemaVersion === 2 && registry.designVersion === 'V5' && registry.baselineCommit === 'b505f6f459db74871f39f63acf6106b827c8a353');
  verify('design-not-activated', registry.activationState === 'design_only' && registry.skills.every(skill => skill.active === false && skill.operations.every(operation => operation.adapter.state === 'unavailable')));
  verify('registry-skill-ids', registry.skills.length === 19 && new Set(registry.skills.map(skill => skill.skillId)).size === 19 && registry.skills.every(skill => byId.has(skill.skillId)));
  const registrationKeys = new Set();
  const registryPairs = new Set();
  const instructionResources = new Map();
  for (const skill of registry.skills) {
    const originalSkill = byId.get(skill.skillId);
    verify('builtin-design-package-' + skill.skillId, skill.manifestSchemaVersion === 2 && skill.provenance === 'builtin' && skill.skillVersion === '5.0.0-design');
    const entry = resourceFile(skill.entryTemplate);
    verify('entry-hash-' + skill.skillId, sha(entry) === skill.entrySha256);
    const body = fs.readFileSync(entry, 'utf8');
    const frontmatter = body.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
    verify('frontmatter-' + skill.skillId, Boolean(frontmatter) && frontmatter[1] === skill.skillId && JSON.parse(frontmatter[2]) === originalSkill.description && body.split('\n').length < 500);
    verify('skill-method-in-entry-' + skill.skillId, body.includes(originalSkill.coreInstructions));
    for (const operation of skill.operations) {
      const pair = skill.skillId + '.' + operation.operationId;
      const key = pair + ':' + (operation.targetKind ?? '');
      verify('unique-binding-' + key, !registrationKeys.has(key));
      registrationKeys.add(key);
      registryPairs.add(pair);
      verify('operation-exists-' + key, pairs.has(pair));
      const original = pairs.get(pair);
      const targetBindings = original.targetBindings ?? [];
      const targetBinding = targetBindings.find(binding => binding.targetKind === operation.targetKind);
      verify('target-binding-route-' + key, operation.targetKind === undefined ? targetBindings.length === 0 : targetBinding !== undefined);
      const expectedInputs = [...new Set([...original.inputKinds, ...(targetBinding?.additionalInputKinds ?? [])])];
      const expectedValidators = [...new Set([...original.validators, ...(targetBinding?.additionalValidators ?? [])])];
      verify('binding-contract-' + key, same(expectedInputs, operation.inputKinds) && original.outputKind === operation.outputKind && same(original.capabilitiesRequested, operation.requestedCapabilities) && original.contextView === operation.contextView && same(expectedValidators, operation.validatorIds) && original.outputBinding === operation.provenanceBinding);
      verify('workflow-budget-binding-' + key, same(operation.workflowVersions, ['v5-proposed']) && operation.budgetPolicyId === 'host-task-budget');
      verify('one-required-operation-resource-' + key, operation.resources.length === 1 && operation.resources[0].kind === 'instructions' && operation.resources[0].use === 'required');
      for (const resource of operation.resources) {
        const resolved = resourceFile(resource.relativePath);
        verify('resource-hash-' + key, sha(resolved) === resource.sha256);
        verify('operation-resource-content-' + key, fs.readFileSync(resolved, 'utf8') === '# ' + original.title + '\n\n' + original.instructions.trimEnd() + '\n');
        verify('operation-resource-id-' + key, resource.resourceId === pair);
        const prior = instructionResources.get(resource.resourceId);
        verify('consistent-resource-binding-' + key, prior === undefined || same(prior, resource));
        instructionResources.set(resource.resourceId, resource);
      }
    }
    const digestInput = { entry: skill.entrySha256, resources: skill.operations.map(operation => [operation.operationId, operation.targetKind ?? null, operation.resources.map(resource => resource.sha256)]) };
    verify('package-content-digest-' + skill.skillId, hashText(pythonJson(digestInput)) === skill.packageDigest);
  }
  verify('binding-count', registrationKeys.size === 44);
  verify('operation-binding-coverage', registryPairs.size === 42 && [...pairs.keys()].every(pair => registryPairs.has(pair)));
  verify('operation-instruction-resource-count', instructionResources.size === 42);
  const packaging = registry.skills.find(skill => skill.skillId === 'packaging').operations.filter(operation => operation.operationId === 'review');
  verify('packaging-discriminants', same(sorted(packaging.map(operation => operation.targetKind)), ['blurb', 'book_title', 'entity_name']));
  const packagingBlueprint = pairs.get('packaging.review');
  verify('packaging-target-binding-identities', same(sorted((packagingBlueprint.targetBindings ?? []).map(binding => binding.targetKind)), ['blurb', 'book_title', 'entity_name']));
  const entityReview = packaging.find(operation => operation.targetKind === 'entity_name');
  const titleReview = packaging.find(operation => operation.targetKind === 'book_title');
  const blurbReview = packaging.find(operation => operation.targetKind === 'blurb');
  verify('entity-name-review-has-no-market-or-publication-promise-dependency', ['TitleEvidenceSnapshotV5', 'PublicationPromiseV5', 'PackagingStoryContextV5'].every(input => !entityReview.inputKinds.includes(input)) && ['title.promise-version-bound', 'research.rank-provenance'].every(validator => !entityReview.validatorIds.includes(validator)));
  verify('book-title-review-has-target-dependencies', ['TitleEvidenceSnapshotV5', 'PublicationPromiseV5', 'PackagingStoryContextV5'].every(input => titleReview.inputKinds.includes(input)) && ['title.promise-version-bound', 'research.rank-provenance'].every(validator => titleReview.validatorIds.includes(validator)));
  verify('blurb-review-has-only-required-target-dependencies', ['PublicationPromiseV5', 'PackagingStoryContextV5'].every(input => blurbReview.inputKinds.includes(input)) && !blurbReview.inputKinds.includes('TitleEvidenceSnapshotV5') && blurbReview.validatorIds.includes('title.promise-version-bound') && !blurbReview.validatorIds.includes('research.rank-provenance'));
  verify('target-kind-only-on-packaging-review', registry.skills.every(skill => skill.operations.every(operation => operation.targetKind === undefined || (skill.skillId === 'packaging' && operation.operationId === 'review'))));
  const migration = load('vnext/skills-v5/migration-map.json');
  verify('migration-counts', migration.from === 'V4' && migration.to === 'V5' && migration.skillCount === 19 && migration.operationCount === 42 && migration.bindingCount === 44);
  verify('migration-operation-routes', migration.changes.every(change => pairs.has(change.skillId + '.' + change.operationId) && promptById.has(change.sourcePromptId)));
  verify('migration-added-operations', same(sorted(migration.changes.filter(change => change.change === 'new_optional_operation').map(change => change.skillId + '.' + change.operationId)), ['world-design.inherit', 'world-design.profile', 'world-design.stress-test']));

  const modules = load('vnext/world-modules-v5.json');
  const expectedModuleIds = ['world-foundation', 'geography-mobility', 'history-calendar', 'society-factions', 'economy-resources', 'ability-rules', 'progression', 'technology-profession', 'investigation-evidence', 'relationship-norms', 'species-ecology', 'system-interface'];
  verify('world-module-count-and-ids', modules.modules.length === 12 && same(sorted(modules.modules.map(module => module.id)), sorted(expectedModuleIds)));
  verify('world-modules-design-only', modules.schemaVersion === 5 && modules.status === 'design_only');
  verify('author-choice-precedence', same(modules.resolutionOrder, ['author_explicit', 'accepted_world_rules', 'current_story_requirements', 'genre_suggestions']));
  verify('world-modules-not-genre-mandatory', modules.defaultState === 'undecided' && modules.modules.every(module => module.requiredByGenreAlone === false));
  verify('custom-module-data-not-code', same(modules.customModules, { allowed: true, namespace: 'custom:', executableCodeAllowed: false }));

  const suite = load('evaluation/platform-world-v5-cases.json');
  verify('evaluation-not-executed', suite.status === 'not_executed');
  verify('case-count-and-unique-ids', suite.cases.length === 32 && new Set(suite.cases.map(item => item.id)).size === 32);
  const caseKinds = { local_contract: 0, model_output: 0, human_blind: 0 };
  const caseSkills = new Set();
  const casePairs = new Set();
  let hostCases = 0;
  for (const item of suite.cases) {
    verify('case-shape-' + item.id, typeof item.request === 'string' && item.request.length > 0 && item.fixture && typeof item.fixture === 'object' && !Array.isArray(item.fixture) && Array.isArray(item.assertions) && item.assertions.length > 0 && item.assertions.every(assertion => typeof assertion === 'string') && Object.hasOwn(caseKinds, item.evaluationKind));
    const hostCase = item.expectedSkill === null && item.expectedOperation === null;
    verify('case-route-' + item.id, hostCase || pairs.has(item.expectedSkill + '.' + item.expectedOperation));
    verify('host-case-kind-' + item.id, !hostCase || item.evaluationKind === 'local_contract');
    caseKinds[item.evaluationKind] += 1;
    if (hostCase) hostCases += 1;
    else {
      caseSkills.add(item.expectedSkill);
      casePairs.add(item.expectedSkill + '.' + item.expectedOperation);
    }
  }
  verify('case-kind-coverage', same(caseKinds, { local_contract: 17, model_output: 13, human_blind: 2 }) && same(suite.coverage.byKind, caseKinds));
  verify('case-route-coverage', suite.coverage.cases === 32 && suite.coverage.hostCases === hostCases && hostCases === 17 && suite.coverage.skillPackages === caseSkills.size && caseSkills.size === 4 && suite.coverage.operationPairs === casePairs.size && casePairs.size === 8 && same(sorted(suite.coverage.skills), sorted(caseSkills)) && same(sorted(suite.coverage.operations), sorted(casePairs)));

  const relativeTypes = ['contracts.ts', 'co-creation-contracts.ts', 'memory-contracts-v3.ts', 'character-mind-v3.ts', 'skill-runtime-v4.ts', 'skill-runtime-v5.ts', 'world-contracts-v5.ts'].map(file => 'vnext/' + file);
  const files = relativeTypes.map(resourceFile);
  const options = { strict: true, noUncheckedIndexedAccess: true, noEmit: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, types: [] };
  const virtualFile = path.join(pack, 'vnext', 'skill-catalog-validation-v5.ts');
  const virtualSource = `import type { SkillCatalogBlueprintV5, SkillRegistryDesignV5 } from './skill-runtime-v5';
import type { SkillEvaluationCaseV4 } from './skill-runtime-v4';
import type { AuthorValueNormalizationV5, PackagingStoryContextV5, ProgressionSystemV5, PublicationPromiseCarrierV5, PublicationPromiseV5, TaxonomyScopeV5, TitleEvidenceSnapshotV5, VersionRefV5, WorldModelV5, WorldModuleIdV5 } from './world-contracts-v5';
import type { MemoryQueryScopeV3, ReadSetV3, StoryWindowV3 } from './memory-contracts-v3';
type WorldModuleCatalogValidationV5 = {
  schemaVersion: 5;
  status: 'design_only';
  resolutionOrder: ['author_explicit', 'accepted_world_rules', 'current_story_requirements', 'genre_suggestions'];
  defaultState: 'undecided';
  modules: { id: Exclude<WorldModuleIdV5, \`custom:\${string}\`>; label: string; purpose: string; requiredByGenreAlone: false }[];
  customModules: { allowed: true; namespace: 'custom:'; executableCodeAllowed: false };
  rules: string[];
};
type EvaluationSuiteValidationV5 = {
  schemaVersion: '1.0';
  suiteId: string;
  createdAt: string;
  status: 'not_executed';
  scope: string;
  executionGuidance: Record<string, string>;
  coverage: { cases: number; skillPackages: number; operationPairs: number; hostCases: number; byKind: { local_contract: number; model_output: number; human_blind: number }; skills: string[]; operations: string[] };
  cases: SkillEvaluationCaseV4[];
};
const catalog: SkillCatalogBlueprintV5 = ${JSON.stringify(catalog)};
const registry: SkillRegistryDesignV5 = ${JSON.stringify(registry)};
const suite: EvaluationSuiteValidationV5 = ${JSON.stringify(suite)};
const modules: WorldModuleCatalogValidationV5 = ${JSON.stringify(modules)};
declare const version: VersionRefV5;
declare const scope: MemoryQueryScopeV3;
declare const storyWindow: StoryWindowV3;
declare const normalizedText: AuthorValueNormalizationV5<string>;
declare const readSet: ReadSetV3;
declare const taxonomyScope: TaxonomyScopeV5;
const noProgression: WorldModelV5['progressionSystems'] = [];
const firstSystem: ProgressionSystemV5 = {
  id: 'system-a', version, projectId: 'project-a', branchId: 'branch-a', name: normalizedText, definition: normalizedText, origin: 'author', queryScope: scope, effectiveStoryWindow: storyWindow,
  applicability: { subjects: { kind: 'entities', entityIds: ['entity-a'] }, conditions: [], conditionCombination: 'all_required', evaluation: 'host_supported' },
  model: { kind: 'none', reason: 'Author selected no levels', authorDecisionId: 'decision-a' }, crossSystemRuleIds: [], sourceRefs: [], fieldLocks: [], authority: { lane: 'candidate', candidateId: 'candidate-a', taskId: 'task-a' }
};
const secondSystem: ProgressionSystemV5 = { ...firstSystem, id: 'system-b', applicability: { ...firstSystem.applicability, subjects: { kind: 'faction_members', factionIds: ['faction-b'], membershipAt: 'queried_story_time' } } };
const independentSystems: WorldModelV5['progressionSystems'] = [firstSystem, secondSystem];
const earlyPackaging: PackagingStoryContextV5 = { authorContractVersion: version, availableWorldVersion: null, openingPlanVersion: null, openingProseVersion: null, confirmedClaimVersionRefs: [version], knownGaps: [{ field: 'world', reason: 'Not created yet', requestedClarification: null }] };
const carrierKinds: PublicationPromiseCarrierV5['kind'][] = ['book_title', 'blurb', 'story_plan', 'prose'];
const earlyPromise: PublicationPromiseV5 = { id: 'promise-a', carrier: { kind: 'book_title', artifactVersion: version }, promiseText: 'Confirmed premise', authorContractVersion: version, worldVersion: null, supportBasis: [{ kind: 'confirmed_setting', claimVersionRefs: [version], sourceRefs: [] }], openingPlanVersion: null, openingProseVersion: null, payoff: { stage: 'opening', targetSceneIds: [], evidenceRefIds: [], state: 'unverified' }, marketEvidenceSnapshotId: null, readSet, state: 'candidate' };
const sampleSelections: TitleEvidenceSnapshotV5['sampleSelections'] = [{ sampleId: 'sample-a', requestedScope: taxonomyScope, matchKind: 'adjacent', basis: { explanation: 'Request-relative evidence comparison', sourceRefIds: [], evidenceClaimIds: [] }, editorialUse: { status: 'partial_reference', reason: 'Adjacent genre only', derivedClaimIds: [] } }];
type AssertV5<T extends true> = T;
type NoLegacySingleProgressionV5 = AssertV5<'progression' extends keyof WorldModelV5 ? false : true>;
type NoTitleOnlyCarrierV5 = AssertV5<'titleCandidateVersion' extends keyof PublicationPromiseV5 ? false : true>;
void [catalog, registry, suite, modules, noProgression, independentSystems, earlyPackaging, carrierKinds, earlyPromise, sampleSelections];
`;
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => path.resolve(fileName) === virtualFile ? ts.createSourceFile(fileName, virtualSource, languageVersion, true) : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([...files, virtualFile], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  verify('typescript-strict-actual-json-and-world-contracts', diagnostics.length === 0, { version: ts.version, strict: true, noUncheckedIndexedAccess: true, contractFiles: relativeTypes, actualJsonAssignments: ['vnext/skill-catalog-v5.json', 'vnext/skills-v5/registry.design.json', 'evaluation/platform-world-v5-cases.json', 'vnext/world-modules-v5.json'], typeWitnesses: ['empty-or-multiple-progression-systems', 'independent-subject-applicability', 'nullable-early-packaging-context', 'four-publication-promise-carriers', 'early-promise-supported-by-confirmed-settings', 'request-scoped-sample-selection', 'removed-legacy-singular-fields'], diagnostics: diagnostics.map(diagnostic => ({ file: diagnostic.file ? path.relative(pack, diagnostic.file.fileName) : null, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') })) });
  for (const file of [...files, fileURLToPath(import.meta.url)]) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, fs.readFileSync(file, 'utf8'));
    let token;
    let comments = 0;
    while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) comments += 1;
    verify('no-code-comments-' + path.basename(file), comments === 0);
  }

  const coreText = fs.readFileSync(resourceFile('runtime/agent.v5.md'), 'utf8');
  const items = catalog.skills.flatMap(skill => skill.operations.map(operation => ({ skillId: skill.id, operationId: operation.id, coreCharacters: codepoints(coreText), skillCharacters: codepoints(skill.coreInstructions), operationCharacters: codepoints(operation.instructions), instructionBodyCharacters: codepoints(coreText) + codepoints(skill.coreInstructions) + codepoints(operation.instructions) })));
  verify('assembly-size-operation-coverage', items.length === 42 && new Set(items.map(item => item.skillId + '.' + item.operationId)).size === 42);
  const sizeReport = { designVersion: 'V5', scope: 'static prompt-body measurement only', unit: 'Unicode codepoints including whitespace', includes: 'core file plus skill method plus selected operation instructions', excludes: ['catalog metadata', 'wrapper text', 'optional references', 'input data', 'actual tool schemas'], notTokenMeasurement: true, notFullRequestMeasurement: true, totalOperations: 42, minimumInstructionBodyCharacters: Math.min(...items.map(item => item.instructionBodyCharacters)), maximumInstructionBodyCharacters: Math.max(...items.map(item => item.instructionBodyCharacters)), items };
  verify('input-files-stable-during-verification', [...inputFiles].every(([relative, hash]) => sha(path.join(pack, relative)) === hash));
  counts = { skills: catalog.skills.length, operations: pairs.size, bindings: registrationKeys.size, promptResources: promptMap.length, preservedV4PromptResources: priorPrompts.length, addedV5PromptResources: addedPromptIds.length, worldModules: modules.modules.length, evaluationCases: suite.cases.length, evaluationCasesExecuted: 0, evaluationRouteCoverage: { skills: caseSkills.size, operations: casePairs.size, hostCases, byKind: caseKinds } };
  const result = { designVersion: 'V5', status: 'passed', scope: 'static design-artifact verification only', checkedAt: new Date().toISOString(), ...counts, checks, inputFiles: [...inputFiles].map(([relativePath, sha256]) => ({ relativePath, sha256 })), checkerSha256: sha(fileURLToPath(import.meta.url)), limitations };
  fs.mkdirSync(auditDirectory, { recursive: true });
  fs.writeFileSync(path.join(auditDirectory, 'skill-assembly-sizes-v5.json'), JSON.stringify(sizeReport, null, 2) + '\n');
  writeAudit(result);
  process.stdout.write(JSON.stringify({ status: result.status, checks: checks.length, ...counts, promptBodyCharacters: { minimum: sizeReport.minimumInstructionBodyCharacters, maximum: sizeReport.maximumInstructionBodyCharacters } }) + '\n');
} catch (error) {
  writeAudit({ designVersion: 'V5', status: 'failed', scope: 'static design-artifact verification only', checkedAt: new Date().toISOString(), ...counts, evaluationCasesExecuted: 0, checks, error: error instanceof Error ? error.message : String(error), limitations });
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
}
