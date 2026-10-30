import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repositoryRoot = path.resolve(process.argv[2] ?? process.cwd());
const readModule = relative => import(pathToFileURL(path.join(repositoryRoot, relative)).href);
const [{ expressionPack }, { configSchema }, { newProject }, { systemPrompt }, { SkillRegistry }, { loadNamingRules, namingPrompt }, { narrativeStreamInstruction }] = await Promise.all([
    readModule('src/core/expression-rules.ts'), readModule('src/shared/types.ts'),
    readModule('src/core/domain.ts'), readModule('src/core/skill.ts'),
    readModule('src/core/skill-registry.ts'), readModule('src/core/naming.ts'),
    readModule('src/shared/narrative-events.ts')
]);
const observedPackageVersion = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).version;
if (observedPackageVersion !== '0.4.82')
    throw new Error('Baseline requires 0.4.82. Do not report a newer version as the original baseline.');
const root = path.join(repositoryRoot, 'resources/skill');
const config = configSchema.parse({}), project = newProject('占位作品', '/analysis-only', config);
const chars = value => Array.from(value).length;
const stages = [['S01', 'tools', undefined, 'planning'], ['S02', 'tools', undefined, 'planning'], ['S03', 'tools', undefined, 'planning'], ['S04', 'tools', undefined, 'planning'], ['S05', 'tools', undefined, 'planning'], ['S06', 'tools', undefined, 'planning'], ['S07', 'tools', undefined, 'planning'], ['S08', 'tools', undefined, 'planning'], ['S09', 'tools', undefined, 'planning'], ['S10', 'prose', undefined, 'prose'], ['S10', 'review', 'webnovel-chapter-reviewer', 'review'], ['S11', 'memory', 'webnovel-memory-extractor', 'record']];
const outputs = stages.map(([stage, mode, skill, expressionMode]) => {
    project.stage = stage;
    const base = systemPrompt(root, project, stage, undefined, skill, { outputMode: mode });
    const expression = expressionPack(root, config, expressionMode);
    return { stage, mode, systemPromptChars: chars(base), expressionChars: chars(expression.prompt), expressionRules: expression.binding.ruleIds.length, totalBeforeRunnerAdditions: chars(base + expression.prompt), ...(mode === 'prose' ? { narrativeStreamExtraChars: chars(narrativeStreamInstruction) } : {}) };
});
const expressionModes = ['planning', 'prose', 'review', 'record', 'revision', 'draft'].map(mode => {
    const value = expressionPack(root, config, mode);
    return { mode, chars: chars(value.prompt), modules: value.binding.modules, rules: value.binding.ruleIds.length };
});
const blocks = [['webnovel-premise-lab', 'tools'], ['webnovel-chapter-drafter', 'prose'], ['webnovel-chapter-reviewer', 'review']].map(([skill, outputMode]) => {
    const content = new SkillRegistry(root).load(skill, { outputMode }).content;
    return { skill, outputMode, chars: chars(content), blocks: content.split(/\n--- /).map(value => ({ title: value.split('\n')[0], chars: chars(value) })) };
});
const result = { head: 'b505f6f459db74871f39f63acf6106b827c8a353', version: '0.4.82', method: '本地展开systemPrompt及expressionPack；默认配置/题材/第一章；Unicode码点；非token；不计作者资料、工具schema、runner额外指令、消息历史；未调用模型', outputs, expressionModes, namingPromptChars: chars(namingPrompt(loadNamingRules(root), '脑洞玄幻')), loadedBlocks: blocks };
console.log(JSON.stringify({ ...result, observedPackageVersion }, null, 2));
