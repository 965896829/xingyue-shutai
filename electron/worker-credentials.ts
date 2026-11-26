import type { Command } from '../src/shared/types';

// These operations can use a saved provider even when the work starts in the
// background, such as a checkpoint scheduling an assessment.
const providerCommands = new Set<Command>([
  'profiles.test', 'style.recommend', 'memory.retrieve', 'embedding.test', 'embedding.reindex',
  'search.test', 'cover.generate', 'lab.generate', 'assessment.refresh', 'draft.checkpoint',
  'design.run', 'run.reviewProse', 'creative.run', 'skill.run', 'state.proposeCorrection',
  'run.start', 'run.resume', 'run.recover', 'run.answer', 'run.permission', 'run.handoff',
  'tags.start', 'tags.selectDirection', 'tags.reviseDirection', 'tags.reroll',
  'creation.start', 'creation.revisePlan', 'titles.start', 'titles.regenerate',
  'memory.rebuild', 'chat.send', 'run.discuss', 'chat.retry', 'proposal.create',
  'proposal.refresh', 'proposal.confirm', 'draft.write', 'draft.chapter', 'draft.promote',
  'diagnostics.export' // Redacts any saved keys from the exported report.
]);

export function needsWorkerCredentials(command: Command, args: Record<string, unknown>) {
  return providerCommands.has(command) || (command === 'run.accept' && args.startNext === true);
}
