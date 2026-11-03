import type { ToolDefinition } from '../../shared/types';
import { ApplicationError } from '../../shared/errors';
import { fingerprint } from './canonical';

export type ToolEffect = 'read' | 'draft_write' | 'candidate_proposal';
export interface HostToolContract {
  name: string;
  version: 1;
  effect: ToolEffect;
  scope: 'task_read' | 'task_draft' | 'task_candidate';
  outputByteLimit: number;
  unknownOutcome: 'revalidate_read' | 'require_resolution';
}

export class HostToolRegistry {
  private readonly contracts = new Map<string, Readonly<HostToolContract>>();
  constructor(contracts: HostToolContract[]) {
    for (const contract of contracts) {
      const scope = { read: 'task_read', draft_write: 'task_draft', candidate_proposal: 'task_candidate' }[
        contract.effect
      ];
      if (
        !contract.name ||
        this.contracts.has(contract.name) ||
        !scope ||
        contract.version !== 1 ||
        contract.scope !== scope ||
        !Number.isSafeInteger(contract.outputByteLimit) ||
        contract.outputByteLimit <= 0 ||
        contract.outputByteLimit > 10_000_000 ||
        contract.unknownOutcome !== (contract.effect === 'read' ? 'revalidate_read' : 'require_resolution')
      )
        throw new ApplicationError('VALIDATION_ERROR', '宿主工具契约无效');
      this.contracts.set(contract.name, Object.freeze({ ...contract }));
    }
  }
  resolve(definition: ToolDefinition) {
    const contract = this.contracts.get(definition.name);
    if (!contract) throw new ApplicationError('PERMISSION_DENIED', '工具没有宿主登记的实现契约');
    return { ...contract, hash: fingerprint({ contract, inputSchema: definition.parameters }) };
  }
}

const effects: Record<string, ToolEffect> = {
  read_naming_rules: 'read',
  read_document: 'read',
  search_memory: 'read',
  validate: 'read',
  ask_author: 'read',
  public_search: 'read',
  extract_pages: 'read',
  read_task_candidate: 'read',
  read_book: 'read',
  search_history: 'read',
  read_history_message: 'read',
  read_rule: 'read',
  propose_changes: 'candidate_proposal',
  propose_memory: 'candidate_proposal',
  propose_action: 'candidate_proposal',
  submit_planning_review: 'candidate_proposal',
  submit_planning_report: 'candidate_proposal',
  submit_creation_contract: 'candidate_proposal',
  submit_title_candidates: 'candidate_proposal',
  submit_title_review: 'candidate_proposal',
  save_draft: 'draft_write'
};

export const hostTools = new HostToolRegistry(
  Object.entries(effects).map(([name, effect]) => ({
    name,
    version: 1,
    effect,
    scope: effect === 'read' ? 'task_read' : effect === 'draft_write' ? 'task_draft' : 'task_candidate',
    outputByteLimit: 10_000_000,
    unknownOutcome: effect === 'read' ? 'revalidate_read' : 'require_resolution'
  }))
);
