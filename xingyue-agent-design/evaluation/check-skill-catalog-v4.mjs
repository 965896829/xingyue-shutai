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
const read = relative => JSON.parse(fs.readFileSync(path.join(pack, relative), 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checks = [];
const verify = (name, condition, details = {}) => {
  checks.push({name, passed:Boolean(condition), ...details});
  if (!condition) throw new Error(name);
};
const catalog = read('vnext/skill-catalog-v4.json');
const schema = read('vnext/skill-catalog-v4.schema.json');
const ajv = new Ajv({allErrors:true, strict:true});
const validate = ajv.compile(schema);
verify('catalog-json-schema', validate(catalog), {errors:validate.errors});
const byId = new Map(catalog.skills.map(s => [s.id,s]));
verify('unique-skill-ids', byId.size === catalog.skills.length);
const pairs = new Set();
for (const skill of catalog.skills) {
  verify('unique-operations-' + skill.id, new Set(skill.operations.map(o => o.id)).size === skill.operations.length);
  for (const op of skill.operations) pairs.add(skill.id + '.' + op.id);
}
const promptMap = read('vnext/skills-v4/prompt-map.json').prompts;
const promptIds = new Set(promptMap.map(p => p.promptId));
verify('prompt-map-unique', promptIds.size === promptMap.length);
for (const item of promptMap) verify('source-hash-' + item.promptId, sha(path.join(pack,item.path)) === item.sha256);
for (const skill of catalog.skills) {
  const refs = [...skill.sourcePromptIds,...skill.operations.flatMap(o => o.sourcePromptIds)];
  verify('source-ids-' + skill.id, refs.every(id => promptIds.has(id)));
}
const registry = read('vnext/skills-v4/registry.design.json');
verify('design-not-activated', registry.activationState === 'design_only' && registry.skills.every(s => !s.active && s.operations.every(o => o.adapter.state === 'unavailable')));
verify('registry-skill-ids', registry.skills.length === catalog.skills.length && registry.skills.every(s => byId.has(s.skillId)));
const registrationKeys = new Set();
const registryPairs = new Set();
for (const skill of registry.skills) {
  verify('entry-hash-' + skill.skillId,sha(path.join(pack,skill.entryTemplate)) === skill.entrySha256);
  const body = fs.readFileSync(path.join(pack,skill.entryTemplate),'utf8');
  const fm = body.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
  verify('frontmatter-' + skill.skillId, Boolean(fm) && fm[1] === skill.skillId && JSON.parse(fm[2]) === byId.get(skill.skillId).description && body.split('\n').length < 500);
  for (const op of skill.operations) {
    const key = skill.skillId + '.' + op.operationId + ':' + (op.targetKind ?? '');
    verify('unique-binding-' + key, !registrationKeys.has(key));
    registrationKeys.add(key);
    registryPairs.add(skill.skillId + '.' + op.operationId);
    verify('operation-exists-' + key, pairs.has(skill.skillId + '.' + op.operationId));
    for (const resource of op.resources) {
      const resolved = path.resolve(pack,resource.relativePath);
      verify('resource-scope-' + key,resolved.startsWith(pack + path.sep));
      verify('resource-hash-' + key,sha(resolved) === resource.sha256);
    }
    const original = byId.get(skill.skillId).operations.find(o => o.id === op.operationId);
    verify('capability-request-' + key, JSON.stringify(original.capabilitiesRequested) === JSON.stringify(op.requestedCapabilities));
  }
}
verify('operation-binding-coverage',registryPairs.size === pairs.size && [...pairs].every(p => registryPairs.has(p)));
const packaging = registry.skills.find(s => s.skillId === 'packaging').operations.filter(o => o.operationId === 'review');
verify('packaging-discriminants',JSON.stringify(packaging.map(o => o.targetKind).sort()) === JSON.stringify(['blurb','book_title','entity_name']));
const suite = read('evaluation/skills-v4-cases.json');
verify('evaluation-not-executed',suite.status === 'not_executed');
verify('case-ids-unique',new Set(suite.cases.map(c => c.id)).size === suite.cases.length);
for (const c of suite.cases) {
  verify('case-shape-' + c.id,typeof c.request === 'string' && c.fixture && typeof c.fixture === 'object' && Array.isArray(c.assertions) && c.assertions.length > 0 && ['local_contract','model_output','human_blind'].includes(c.evaluationKind));
  verify('case-route-' + c.id,(c.expectedSkill === null && c.expectedOperation === null) || pairs.has(c.expectedSkill + '.' + c.expectedOperation));
}
const files = ['contracts.ts','co-creation-contracts.ts','memory-contracts-v3.ts','character-mind-v3.ts','skill-runtime-v4.ts'].map(f => path.join(pack,'vnext',f));
const options = {strict:true,noUncheckedIndexedAccess:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,skipLibCheck:true,types:[]};
const virtualFile = path.join(pack,'vnext','skill-catalog-validation.ts');
const virtualSource = `import type {SkillCatalogBlueprintV4, SkillRegistryDesignV4, SkillEvaluationCaseV4} from './skill-runtime-v4';\nconst catalog: SkillCatalogBlueprintV4 = ${JSON.stringify(catalog)};\nconst registry: SkillRegistryDesignV4 = ${JSON.stringify(registry)};\nconst cases: SkillEvaluationCaseV4[] = ${JSON.stringify(suite.cases)};\nvoid [catalog,registry,cases];\n`;
const host = ts.createCompilerHost(options);
const originalGetSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (fileName,languageVersion,onError,shouldCreateNewSourceFile) => path.resolve(fileName) === virtualFile ? ts.createSourceFile(fileName,virtualSource,languageVersion,true) : originalGetSourceFile(fileName,languageVersion,onError,shouldCreateNewSourceFile);
const program = ts.createProgram([...files,virtualFile],options,host);
const diagnostics = ts.getPreEmitDiagnostics(program);
verify('typescript-strict',diagnostics.length === 0,{diagnostics:diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText,'\n')),version:ts.version});
for (const file of [...files,fileURLToPath(import.meta.url)]) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,fs.readFileSync(file,'utf8'));
  let token;
  let comments = 0;
  while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) comments++;
  verify('no-code-comments-' + path.basename(file),comments === 0);
}
const result = {designVersion:'V4',status:'passed',scope:'static design-artifact verification only',skills:catalog.skills.length,operations:pairs.size,bindings:registrationKeys.size,promptResources:promptMap.length,evaluationCases:suite.cases.length,evaluationCasesExecuted:0,checks,limitations:['No application integration','No paid model calls','No reader blind evaluation','No product-behavior regressions executed']};
fs.writeFileSync(path.join(pack,'audit/skill-catalog-verification-v4.json'),JSON.stringify(result,null,2) + '\n');
process.stdout.write(JSON.stringify({status:result.status,checks:checks.length,skills:result.skills,operations:result.operations,bindings:result.bindings,evaluationCases:result.evaluationCases,evaluationCasesExecuted:0}) + '\n');
