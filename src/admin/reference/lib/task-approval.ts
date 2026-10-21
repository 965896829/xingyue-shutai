export type TaskRequest = { projectId: string; kind: string; input: Record<string, unknown>; registration_only?: boolean; opening_preferences?: boolean };
type Approval = (tasks: TaskRequest[], signal?: AbortSignal | null) => Promise<number[]>;
let approve: Approval | null = null;
export function registerTaskApproval(handler: Approval) {
  approve = handler;
  return () => { if (approve === handler) approve = null; };
}
export function approveTasks(tasks: TaskRequest[], signal?: AbortSignal | null) {
  if (!approve) throw new Error("费用确认尚未就绪，请稍后再试。");
  return approve(tasks, signal);
}
export function taskForRequest(path: string, body: any): TaskRequest | null {
  if (!body || typeof body !== "object" || (body.budget !== undefined && !Number.isSafeInteger(body.budget))) return null;
  let match = path.match(/^\/projects\/([^/]+)\/runs$/);
  if (match && !["builtin-test", "rule-quality", "review-calibration"].includes(body.kind))
    return { projectId: match[1], kind: body.kind || "draft", input: body.input || {} };
  match = path.match(/^\/studio\/projects\/([^/]+)\/writing-goals$/);
  if (match) return { projectId: match[1], kind: "writing-goal", input: {
    model: body.model, reasoning_effort: body.reasoning_effort, chapter: body.chapter,
    instruction: body.instruction, stream: true,
  } };
  match = path.match(/^\/studio\/projects\/([^/]+)\/creation\/stages\/([^/]+)\/generate$/);
  if (match) return { projectId: match[1], kind: "creation-stage", input: { stage_key: match[2], chapter: body.chapter, model: body.model, instruction: body.instruction } };
  match = path.match(/^\/studio\/projects\/([^/]+)\/creation\/characters\/registration\/generate$/);
  if (match) return { projectId: match[1], kind: "creation-stage", registration_only: true, input: { stage_key: "characters", chapter: body.chapter, model: body.model, instruction: body.instruction } };
  match = path.match(/^\/studio\/projects\/([^/]+)\/start\/generate$/);
  if (match) return { projectId: match[1], kind: "idea", opening_preferences: !!body.use_suggested_preferences, input: {
    model: body.model, guide_mode: body.mode, guide_message: body.message || "", stream: true,
    ...(body.mode === "chat" ? { reasoning_effort: body.reasoning_effort, chat_action: body.chat_action } : {}),
    ...(body.search || { candidate_count: body.candidate_count, max_rounds: body.max_rounds }),
  } };
  return null;
}
export async function approvedBody(path: string, body: string, signal?: AbortSignal | null) {
  const value = JSON.parse(body), task = taskForRequest(path, value);
  if (!task) return body;
  const [budget] = await approveTasks([task], signal);
  return JSON.stringify({ ...value, budget });
}
