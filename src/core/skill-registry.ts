import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { hash } from './domain';
import { safePath } from './storage';
import { sharedRuleBlock } from './runtime/prompt-cache';
import type { StageId } from '../shared/types';
import { chapterNamingSkills } from './chapter-naming';
import { creationPolicies, creationPolicy } from './creation-policy';
import { skillExecutionSchema } from '../shared/skill-contract';
import { promptProfileVersion } from './prompt-profile';

const entrySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  stage: z.string(),
  optional: z.boolean(),
  path: z.string(),
  contract: z.string(),
  sha256: z.string(),
  tools: z.array(z.string())
});
export type SkillEntry = z.infer<typeof entrySchema>;
export type SkillOutputMode = 'tools' | 'prose' | 'review' | 'memory';
export const stageSkills: Record<StageId, string> = {
  S01: 'webnovel-premise-lab',
  S02: 'webnovel-project-config',
  S03: 'webnovel-world-engine',
  S04: 'webnovel-character-engine',
  S05: 'webnovel-volume-architect',
  S06: 'webnovel-chapter-roadmap',
  S07: 'webnovel-rhythm-designer',
  S08: 'webnovel-batch-outline',
  S09: 'webnovel-chapter-planner',
  S10: 'webnovel-chapter-drafter',
  S11: 'webnovel-memory-extractor'
};
export function skillAllowsPath(skillId: string | undefined, relative: string) {
  if (skillId === 'webnovel-prose-polisher') return relative.startsWith('07_正文章节/');
  if (skillId === 'webnovel-voice-profile') return relative === '02_项目配置/文风样本与规则.md';
  if (skillId === 'webnovel-name-governance') return /^(03_|04_|06_|07_)/.test(relative);
  return true;
}
const hostSkills = new Set([
  'webnovel-project-bootstrap',
  'webnovel-project-validator',
  'webnovel-context-retriever',
  'webnovel-batch-close',
  'webnovel-memory-audit'
]);
export class SkillRegistry {
  readonly root: string;
  readonly entries: SkillEntry[];
  readonly lock: Record<string, string>;
  constructor(skillRoot: string) {
    this.root = path.join(skillRoot, 'runtime');
    this.lock = JSON.parse(fs.readFileSync(path.join(this.root, 'resources.lock.json'), 'utf8'));
    this.entries = z
      .object({ skills: z.array(entrySchema).length(26) })
      .parse(JSON.parse(this.read('skills.registry.json'))).skills;
    if (new Set(this.entries.map((e) => e.id)).size !== 26) throw new Error('内置技能编号重复');
  }
  read(relative: string) {
    const raw = fs.readFileSync(safePath(this.root, relative));
    if (relative === 'agent.md') {
      if (!raw.toString('utf8').trim() || raw.includes(0) || raw.length > 96_000)
        throw new Error('总控规则 agent.md 为空、格式无效或超过 96 KB，请修正规则后继续');
    } else if (this.lock[relative] !== hash(raw)) throw new Error(`内置规则完整性检查失败：${relative}`);
    return raw.toString('utf8');
  }
  controller() {
    const content = this.read('agent.md');
    return { content, hash: hash(content) };
  }
  get(skillId: string) {
    const entry = this.entries.find((s) => s.id === skillId);
    if (!entry) throw new Error('未知技能');
    const contract = JSON.parse(this.read(entry.contract));
    if (
      contract.can_approve ||
      contract.can_commit ||
      contract.can_publish ||
      contract.write_scope !== 'candidate-only'
    )
      throw new Error('技能权限契约无效');
    if (JSON.stringify(contract.tools) !== JSON.stringify(entry.tools)) throw new Error('技能工具契约不一致');
    return { ...entry, host: hostSkills.has(skillId), execution: skillExecutionSchema.parse(contract.execution) };
  }
  load(skillId: string, options: { outputMode?: SkillOutputMode; legacyVolumeNaming?: boolean; volumeNamingVersion?: 1 | 2; chapterNamingVersion?: 1; chapterTitleFixed?: boolean } = {}) {
    const entry = this.get(skillId),
      current = this.read(entry.path),
      controller = this.controller();
    if (hash(current) !== entry.sha256) throw new Error('技能版本与注册表不一致');
    // Persisted naming versions control contracts and research budgets, not creative policy.
    // The changed hash sends in-flight tasks through the existing version handoff.
    const content = current;
    const files = new Set<string>(['references/shared-contract.md']);
    if (chapterNamingSkills.includes(skillId)) files.add('references/chapter-naming-commercial.md');
    for (const match of content.matchAll(/`(\.\.\/\.\.\/references\/[^`]+\.md)`/g)) {
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), match[1]));
      if (!relative.includes('/naming/')) files.add(relative);
    }
    const rawMode = options.outputMode === 'prose';
    const operation = creationPolicies[skillId];
    const policy = operation ? creationPolicy(path.dirname(this.root), operation) : undefined;
    if (policy && /^## 规则(?:\s|$)/m.test(content)) throw new Error('专项技能包含重复的旧创作规则');
    const specialist = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
      .split(/(?=^## )/m).filter(section => !rawMode || !/^## 输出(?:契约)?(?:\s|$)/.test(section)).join('');
    // Validate every declared dependency even when its tool-output instructions are
    // omitted from a prose subcall. Review and memory phases submit tool candidates.
    const references = [...files].map(file => ({ file, content: this.read(file) }));
    return {
      entry,
      content: [controller.content, `\n--- 当前专项技能：${entry.title} ---\n${specialist}`, ...(policy ? [policy.content] : []),
        ...references.filter(({ file }) => (!rawMode || !['references/shared-contract.md', 'references/chapter-naming-commercial.md'].includes(file)) &&
          (!options.chapterTitleFixed || file !== 'references/chapter-naming-commercial.md'))
          .map(({ file, content: reference }) => {
            const block = `\n--- ${file} ---\n${reference}`;
            return file === 'references/shared-contract.md' ? sharedRuleBlock('shared-contract', block) : block;
          })].join('\n'),
      hash: hash(JSON.stringify([promptProfileVersion, 'current-policy-3', controller.hash, entry,
        ...(policy ? [policy.hash] : []), ...[...files].map((f) => this.lock[f])]))
    };
  }
}
