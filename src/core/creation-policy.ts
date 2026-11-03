import fs from 'node:fs';
import path from 'node:path';
import { hash } from './domain';

// Shared craft is composed here for both default stages and explicit operations.
// Operation contracts, visibility and execution remain owned by their adapters.
export const professionalMethods: Record<string, string[]> = {
  'co-creation.discuss': ['co-editor'], 'co-creation.compare': ['co-editor'], 'co-creation.propose': ['co-editor'],
  'world-design.create': ['world'], 'world-design.profile': ['world'], 'world-design.inherit': ['world'], 'world-design.stress-test': ['world'],
  'character-design.create': ['character'], 'character-reflection.reflect': ['character'],
  'rolling-outline.book': ['architecture'], 'rolling-outline.volume': ['architecture'],
  'rolling-outline.roadmap': ['planning'], 'rolling-outline.rhythm': ['planning'], 'rolling-outline.batch': ['planning'], 'scene-contract.plan': ['planning'],
  'chapter-draft.draft': ['prose'], 'explore': ['prose'],
  'memory-delta.extract': ['memory'], 'memory-review.review': ['memory'], 'memory-query.answer': ['memory'], 'memory-repair': ['memory'],
  'voice-calibration.extract': ['voice'], 'voice-calibration.calibrate': ['voice'], 'voice-calibration.update': ['voice'], 'voice-pilot': ['voice'], 'learn-edits': ['voice'],
  'revision.voice': ['revision'], 'revision.local': ['revision'], 'revision.story': ['revision'],
  'canon-audit.continuity': ['audit'], 'canon-audit.impact': ['audit'], 'canon-audit.promise': ['audit'], 'canon-audit.ending': ['audit'], 'patterns': ['audit'],
  'reader-feedback.analyze': ['feedback'], 'compare-feedback': ['feedback'],
  'packaging.title': ['packaging'], 'packaging.blurb': ['packaging'], 'packaging.review': ['packaging'], 'packaging.entity-name': ['packaging'],
  'title-writer': ['packaging'], 'title-reviewer': ['packaging']
};

export function professionalMethod(root: string, name: string) {
  if (!/^[a-z-]+$/.test(name)) throw new Error('未知创作方法');
  return readPolicy(root, `methods/${name}.md`);
}

export function composeProfessionalMethod(root: string, operation: string, specific: string) {
  return [...(professionalMethods[operation] ?? []).map(name => professionalMethod(root, name).content), specific].join('\n\n');
}

export function conditionalCreationPolicy(root: string, stage: string, material: string) {
  if (!['S01', 'S03'].includes(stage) || !/(?:契约|权属|所有权|保管|继承|转让|转移.{0,12}(?:权利|资源|能力|身份)|(?:权利|资源|能力|身份).{0,12}(?:转移|终止)|退出.{0,12}(?:组织|契约|宗门|系统))/.test(material)) return '';
  return readPolicy(root, 'conditions/rights-transfer.md').content;
}

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
  'webnovel-revision-cascade': 'revision.local',
  'webnovel-continuity-audit': 'canon-audit.continuity',
  'webnovel-market-research': 'market-evidence.research',
  'webnovel-name-governance': 'packaging.entity-name',
  'webnovel-reader-feedback': 'reader-feedback.analyze'
};

export function creationPolicy(root: string, operation: string) {
  if (!/^[a-z-]+\.[a-z-]+$/.test(operation)) throw new Error('未知创作操作');
  const specific = readPolicy(root, `${operation}.md`);
  const content = composeProfessionalMethod(root, operation, specific.content);
  const condition = operation === 'premise.analyze' || operation.startsWith('world-design.')
    ? readPolicy(root, 'conditions/rights-transfer.md').hash : undefined;
  return { content, hash: condition ? hash(JSON.stringify([content, condition])) : hash(content) };
}

function readPolicy(root: string, file: string) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'design-v7/resources.lock.json'), 'utf8'));
  const content = fs.readFileSync(path.join(root, 'design-v7', file), 'utf8');
  if (hash(content) !== lock[file]) throw new Error('创作语义资源完整性检查失败');
  return { content, hash: hash(content) };
}
