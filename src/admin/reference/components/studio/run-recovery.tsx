"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@reference/lib/api";
import { authorProblem } from "@reference/lib/author-copy";
import { Modal } from "../reference-ui";
import { Spinner, ErrorState } from "../ui";
import { useAction } from "./shared";
import { ResumeCost, continuationChoice, type ResumeQuote } from "./resume-cost";

export function RunRecovery({
  run,
  onResumed,
  allowCompletedReview = false,
  label,
}: {
  run: any;
  onResumed?: (id: string) => void;
  allowCompletedReview?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false),
    [customLimit, setCustomLimit] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [reconciling, setReconciling] = useState(false);
  const cache=useQueryClient(),request=useRef<{signature:string;key:string}|null>(null);
  const act = useAction();
  const q = useQuery({
    queryKey: ["run-checkpoints", run.id],
    queryFn: () => api(`/runs/${run.id}/checkpoints`),
    enabled: open,
  });
  const estimate = useQuery<ResumeQuote>({
    queryKey: ["run-resume-estimate", run.id, run.version],
    queryFn: () => api(`/runs/${run.id}/resume-estimate`, { suppressErrorNotice: true }),
    enabled: open && q.data?.can_resume === true,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const totalLimit = customLimit ?? estimate.data?.recommended_total_limit ?? 0;
  const choice = estimate.data ? continuationChoice(estimate.data, totalLimit) : null;
  const ready = q.data?.can_resume && estimate.data?.can_resume && !estimate.isFetching && !estimate.error && !choice?.error;
  async function resume() {
    if (!estimate.data || !ready) throw new Error("请先查看最新的剩余工作与费用预估。");
    const body = { expected_version: estimate.data.run_version, quote_token: estimate.data.quote_token,
      total_limit: choice?.personal ? null : totalLimit, confirm_increase: !!choice?.additional };
    const signature=JSON.stringify([run.id,body]),storageKey=`novel:resume:${run.id}`;
    if(request.current?.signature!==signature){
      let saved=null;
      try {saved=JSON.parse(window.sessionStorage.getItem(storageKey)||"null");}catch{}
      request.current=saved?.signature===signature&&typeof saved.key==="string" ? saved : {signature,key:crypto.randomUUID()};
      try {window.sessionStorage.setItem(storageKey,JSON.stringify(request.current));}catch{}
    }
    let result:any;
    try {
      result=await api(`/runs/${run.id}/resume`,{method:"POST",headers:{"Idempotency-Key":request.current!.key},body:JSON.stringify(body),suppressErrorNotice:true});
    }catch(error){
      const status=(error as any)?.status,code=(error as any)?.code;
      if (code === "resume_estimate_changed") {
        request.current=null;
        await Promise.all([q.refetch(), estimate.refetch()]);
        throw error;
      }
      if(status && status<500 && (status!==409 || code==="request_busy"))throw error;
      setReconciling(true);
      const deadline=Date.now()+4500;
      try {
        for(const delay of [0,500,1000,2000]){
          if(delay)await new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(delay,deadline-Date.now()))));
          const remaining=deadline-Date.now();if(remaining<=0)break;
          try {
            const checkpoint=await api(`/runs/${run.id}/checkpoints`,{suppressErrorNotice:true,signal:AbortSignal.timeout(Math.min(remaining,1000))});
            cache.setQueryData(["run-checkpoints",run.id],checkpoint);
            if(typeof checkpoint.resumed_run_id==="string"&&checkpoint.resumed_run_id){result={id:checkpoint.resumed_run_id};break;}
          }catch{}
        }
      }finally{setReconciling(false);}
      if(!result){
        if(status===409)throw error;
        throw new Error("暂时无法确认是否已继续，已有内容保留。请稍后查看进度，再决定是否重试。");
      }
    }
    request.current=null;
    try {window.sessionStorage.removeItem(storageKey);}catch{}
    return result;
  }
  const contextProblem = run.state === "paused_context" && run.error
    ? authorProblem({code:run.error_code,message:run.error,fields:run.error_fields,kind:run.kind},0,`/studio/book/${run.project_id}/draft`)
    : null;
  const setupPath = `/studio/book/${run.project_id}/setup`;
  const restartPreparation = run.kind === "book-prepare" && run.state === "paused_context" && q.data?.can_resume === false && !q.data.resumed_run_id;
  if (
    run.kind === "builtin-test" ||
    !(allowCompletedReview && run.kind === "review" && run.state === "succeeded") && ![
      "failed",
      "cancelled",
      "paused_budget",
      "paused_policy",
      "paused_context",
      "waiting_author",
    ].includes(run.state)
  )
    return null;
  return (
    <>
      <button className="s-text-button" onClick={() => {setCustomLimit(null);setOpen(true);}}>
        {label || (allowCompletedReview ? "查看未完成检查" : run.state === "waiting_author" ? "查看写作进度" : run.state === "paused_context" ? "查看进度与处理方式" : q.data?.can_resume === false ? "查看已保存的进度" : "从已完成部分继续")}
      </button>
      {open && (
        <Modal
          title={allowCompletedReview ? "核对未完成的检查" : q.data?.story_options_ready ? "继续比较故事方案" : run.state === "paused_context" ? "查看进度与处理方式" : "继续未完成的任务"}
          onClose={() => setOpen(false)}
          footer={restartPreparation ? <a className="s-btn primary" href={setupPath} onClick={()=>setOpen(false)}>返回人物和大纲</a> :
            <button
              className="s-btn primary"
              disabled={busy || q.isFetching || !ready}
              onClick={async () => {
                if(busy || q.isFetching || !ready)return;
                setBusy(true);
                try {
                  const result = await act(
                    resume,
                    "继续任务已排队，仍可使用的结果会保留",
                  );
                  onResumed?.((result as any).id);
                  setOpen(false);
                } catch {
                } finally {
                  setBusy(false);
                }
              }}
            >
              {reconciling ? "正在核对任务…" : busy ? "正在提交…" : choice?.additional ? `追加 ${choice.additional} 点并继续` : q.data?.story_options_ready ? "继续比较" : "继续剩余工作"}
            </button>
          }
        >
          {reconciling && <p role="status">正在核对服务器是否已创建续任务，请稍候。</p>}
          {contextProblem && !q.data?.story_options_ready && <div className="s-warning"><p>{contextProblem.message}</p>{contextProblem.action.href && !restartPreparation && <a className="s-link" href={contextProblem.action.href} onClick={()=>setOpen(false)}>{contextProblem.action.label}</a>}</div>}
          {q.isPending ? (
            <Spinner />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : (
            <>
              <p>
                {q.data.story_options_ready ? `${q.data.saved_story_options} 个故事方案已保存。继续会复用这些方案的原文，接着完成比较和建议。` : ""}
                {q.data.creation_reply_ready ? "完整回复已保存，会复用原文并继续未完成的检查。" : q.data.draft_ready ? "完整正文已保存。" : ""}
                {q.data.completed_scenes ? `已写完 ${q.data.completed_scenes} 场。` : ""}
                {q.data.completed_idea_rounds ? `已保存 ${q.data.completed_idea_rounds} 轮故事方案。` : ""}
                {q.data.completed_review_batches ? "已有检查结果已保存。" : ""}
                {q.data.completed_embedding_batches ? "已有参考资料已保存。" : ""}
                {q.data.completed_assistant_steps && !q.data.story_options_ready ? `已完成 ${q.data.completed_assistant_steps} 个助手步骤。` : ""}
              </p>
              {contextProblem && q.data.story_options_ready && <p>上次比较因参考内容过长而暂停；继续时会整理本轮参考资料，已收到的方案保持原文。</p>}
              {q.data.step_preview && <details open><summary>{q.data.step_name || "本次已完成的内容"}</summary><pre style={{ whiteSpace: "pre-wrap" }}>{q.data.step_preview}</pre></details>}
              {q.data.saved_ideas?.map((idea: any) => <details key={idea.id}><summary>{idea.title}</summary><p>{idea.goal}</p><p>{idea.action}</p><p>{idea.cost}</p></details>)}
              {!q.data.can_resume && <p>{q.data.resumed_run_id ? "这次任务已经继续处理，请查看最新一条任务的进度。" : restartPreparation ? "这次尚未生成完整的人物和大纲。返回准备页后，可按当前作品资料重新准备。" : contextProblem ? "暂时不能从已完成部分继续，请先处理上面的原因。" : "暂时无法接着处理。请回到作品，保存已收到的内容后重新开始。"}</p>}
              {q.data.nodes_complete && run.state === "waiting_author" && (
                <p>步骤已完成，请回到审稿与定稿页确认。</p>
              )}
            </>
          )}
          {q.data?.can_resume && (estimate.isPending ? <p role="status">正在核对剩余工作与费用…</p>
            : estimate.error ? <div role="alert"><p>暂时无法估算：{estimate.error.message}</p><button type="button" className="s-text-button" disabled={estimate.isFetching} onClick={() => estimate.refetch()}>重新估算</button></div>
            : estimate.data && <ResumeCost quote={estimate.data} limit={totalLimit} custom={customLimit !== null} onChange={setCustomLimit} busy={busy || estimate.isFetching} />)}
        </Modal>
      )}
    </>
  );
}
