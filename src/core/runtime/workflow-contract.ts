import type { Run } from '../../shared/types';
import { workflowBindingSchema, type WorkflowBinding } from '../../shared/workflow';
import { ApplicationError } from '../../shared/errors';

export function workflowKind(run: Run): WorkflowBinding['kind'] {
  if (run.creative) return 'discussion';
  if (run.naming || run.planning) return 'creation';
  if (run.memoryRepair || run.mode !== 'stage') return 'revision';
  return run.stage <= 'S04' ? 'creation' : 'chapter';
}

export function bindWorkflow(run: Run) {
  if (run.workflowVersion !== 1) {
    if (run.workflowVersion !== undefined || run.workflowBinding !== undefined)
      throw new ApplicationError('PROJECT_VERSION_UNSUPPORTED', '工作流版本不受支持，任务保留为只读');
    return;
  }
  if (!run.workflowBinding)
    run.workflowBinding = {
      schemaVersion: 7,
      kind: workflowKind(run),
      version: 1,
      handlerVersion: 1,
      registry: run.creative ? 'creative-v7-v1' : run.design ? 'scoped-design-v1' : 'builtin-26-v1',
      contextPolicy: run.creative ? `${run.creative.audience}-v1` : 'author-v1',
      executorId: run.executorId ?? 'legacy',
      executorVersion: run.executorVersion ?? '1',
      checkpointVersion: run.checkpointVersion ?? 1,
      budgetOwner: run.parentRunId ?? run.id,
      restorePolicy: 'recorded_versions_only'
    };
  assertWorkflow(run);
}

export function assertWorkflow(run: Run) {
  if (run.workflowVersion === undefined && run.workflowBinding === undefined) return;
  const result = workflowBindingSchema.safeParse(run.workflowBinding);
  if (run.workflowVersion !== 1 || !result.success)
    throw new ApplicationError(
      'PROJECT_VERSION_UNSUPPORTED',
      '工作流或处理器合同版本不受支持，任务保留为只读'
    );
  const binding = result.data;
  if (
    binding.registry !== (run.creative ? 'creative-v7-v1' : run.design ? 'scoped-design-v1' : 'builtin-26-v1') ||
    binding.contextPolicy !== (run.creative ? `${run.creative.audience}-v1` : 'author-v1') ||
    (run.creative && run.creative.version !== 1) || (run.design && run.design.version !== 1)
  )
    throw new ApplicationError('PROJECT_VERSION_UNSUPPORTED', '任务上下文策略版本不受支持，未重新发送');
  if (
    binding.kind !== workflowKind(run) ||
    binding.executorId !== (run.executorId ?? 'legacy') ||
    binding.executorVersion !== (run.executorVersion ?? '1') ||
    binding.checkpointVersion !== (run.checkpointVersion ?? 1) ||
    binding.budgetOwner !== (run.parentRunId ?? run.id)
  )
    throw new ApplicationError('VERSION_CONFLICT', '任务工作流、执行器或预算归属与保存的合同不一致');
}
