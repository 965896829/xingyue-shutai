import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { hash } from './domain';
import { safePath } from './storage';
import type { StageId } from '../shared/types';

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
    if (this.lock[relative] !== hash(raw)) throw new Error(`内置规则完整性检查失败：${relative}`);
    return raw.toString('utf8');
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
    return { ...entry, host: hostSkills.has(skillId) };
  }
  load(skillId: string) {
    const entry = this.get(skillId),
      content = this.read(entry.path);
    if (hash(content) !== entry.sha256) throw new Error('技能版本与注册表不一致');
    const files = new Set<string>(['references/shared-contract.md']);
    for (const match of content.matchAll(/`(\.\.\/\.\.\/references\/[^`]+\.md)`/g)) {
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), match[1]));
      if (!relative.includes('/naming/')) files.add(relative);
    }
    return {
      entry,
      content: [content, ...[...files].map((f) => `\n--- ${f} ---\n${this.read(f)}`)].join('\n'),
      hash: hash(JSON.stringify([entry, ...[...files].map((f) => this.lock[f])]))
    };
  }
}
