import fs from 'node:fs';
import path from 'node:path';
import { hash } from './domain';

export const creationPolicies: Record<string, string> = {
  'webnovel-premise-lab': 'premise.analyze',
  'webnovel-project-config': 'story-contract.configure',
  'webnovel-world-engine': 'world-design.create',
  'webnovel-character-engine': 'character-design.create',
  'webnovel-volume-architect': 'rolling-outline.volume',
  'webnovel-chapter-roadmap': 'rolling-outline.roadmap',
  'webnovel-rhythm-designer': 'rolling-outline.rhythm',
  'webnovel-batch-outline': 'rolling-outline.batch',
  'webnovel-chapter-planner': 'scene-contract.plan',
  'webnovel-chapter-drafter': 'chapter-draft.draft',
  'webnovel-chapter-reviewer': 'chapter-review.review',
  'webnovel-memory-extractor': 'memory-delta.extract',
  'webnovel-memory-audit': 'memory-review.review',
  'webnovel-packaging': 'packaging.title',
  'webnovel-voice-profile': 'voice-calibration.extract',
  'webnovel-prose-polisher': 'revision.voice',
  'webnovel-revision-cascade': 'revision.local'
};

export function creationPolicy(root: string, operation: string) {
  const file = `${operation}.md`;
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'design-v7/resources.lock.json'), 'utf8'));
  const content = fs.readFileSync(path.join(root, 'design-v7', file), 'utf8');
  if (hash(content) !== lock[file]) throw new Error('创作语义资源完整性检查失败');
  return { content, hash: hash(content) };
}
