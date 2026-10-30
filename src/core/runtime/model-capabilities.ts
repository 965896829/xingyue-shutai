import type { Run, SecretProfile, ToolDefinition } from '../../shared/types';
import { supportsDocumentDrafts } from './document-drafts';

export function taskModelOptions(run: Run, profile: SecretProfile, tools: ToolDefinition[]) {
  if (run.pipeline?.coverageVersion === 1) return { singleToolCall: true };
  if (
    profile.protocol !== 'responses' ||
    !/^gpt-(?:5\.6-(?:sol|terra|luna)|6(?:\.1)?-(?:sol|astra|luna))(?:-\d{4}-\d{2}-\d{2})?$/.test(
      profile.model
    ) ||
    run.mode !== 'stage' ||
    run.naming ||
    run.planning ||
    !/^S(?:0[1-9]|10|11)$/.test(run.stage)
  )
    return { singleToolCall: supportsDocumentDrafts(run) };
  return {
    cacheTools: tools.filter((tool) => !['public_search', 'extract_pages'].includes(tool.name)),
    singleToolCall: true
  };
}
