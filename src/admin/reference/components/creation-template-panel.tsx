"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post, put } from "@reference/lib/api";
import { ErrorState, Spinner, useToast } from "./ui";
import { Modal } from "./reference-ui";
import "./studio/creation-workbench.css";

type StageConfig={key:string;role:string;instruction:string;checks:string[];budget:number;max_tokens:number};
type TemplateConfig={batch_size:number;stages:StageConfig[]};
type TemplateState={
  version:number;published_version?:number;published:TemplateConfig|{version?:number;config:TemplateConfig};draft:TemplateConfig|{config:TemplateConfig}|null;
  stages:{key:string;label:string;required_inputs:string[];scope:string}[];roles:{key:string;name:string}[];
};
function configOf(value:TemplateState["published"]|TemplateState["draft"]):TemplateConfig|null {
  if(!value)return null;return "config" in value?value.config:value;
}
export function CreationTemplatePanel({defaultOpen=false}:{defaultOpen?:boolean}) {
  const [open,setOpen]=useState(defaultOpen),[config,setConfig]=useState<TemplateConfig|null>(null),[baseVersion,setBaseVersion]=useState(0);
  const [selected,setSelected]=useState("premise"),[dirty,setDirty]=useState(false),[reason,setReason]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[publishing,setPublishing]=useState(false);
  const toast=useToast(),path="/admin/creation/templates";
  const q=useQuery<TemplateState>({queryKey:["creation-templates"],queryFn:()=>api(path),enabled:open});
  useEffect(()=>{if(q.data&&!dirty){setConfig(structuredClone(configOf(q.data.draft)||configOf(q.data.published)));setBaseVersion(q.data.version);}},[q.data,dirty]);
  const current=config?.stages.find(stage=>stage.key===selected)||config?.stages[0];
  const meta=q.data?.stages.find(stage=>stage.key===current?.key);
  function update(patch:Partial<StageConfig>) {
    if(!config||!current)return;setDirty(true);setConfig({...config,stages:config.stages.map(stage=>stage.key===current.key?{...stage,...patch}:stage)});
  }
  async function save() {
    if(!config||reason.trim().length<2)return;setBusy(true);setError("");
    const payload={...config,stages:config.stages.map(stage=>({...stage,checks:stage.checks.map(value=>value.trim()).filter(Boolean)}))};
    try{await put(path+"/draft",{expected_version:baseVersion,config:payload,reason:reason.trim()});setDirty(false);await q.refetch();toast("流程草稿已保存，发布后供新作品使用");}
    catch(e){setError(e instanceof Error?e.message:"保存失败，请重试。");}
    finally{setBusy(false);}
  }
  async function publish() {
    if(dirty||reason.trim().length<2)return;setBusy(true);setError("");
    try{await post(path+"/publish",{expected_version:baseVersion,reason:reason.trim()});setPublishing(false);await q.refetch();toast("创作流程已发布");}
    catch(e){setError(e instanceof Error?e.message:"发布失败，请重试。");}
    finally{setBusy(false);}
  }
  const valid=config&&Number.isInteger(config.batch_size)&&config.batch_size>=1&&config.batch_size<=60&&config.stages.every(stage=>stage.role&&stage.instruction.trim().length>=20&&stage.instruction.length<=16000&&stage.checks.filter(value=>value.trim()).length<=20&&stage.checks.every(value=>value.length<=1000)&&Number.isInteger(stage.budget)&&stage.budget>=1&&stage.budget<=10000&&Number.isInteger(stage.max_tokens)&&stage.max_tokens>=512&&stage.max_tokens<=32000);
  return <details className="s-creation-template" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>完整创作流程 · 阶段、智能体与发布</summary>
    {open&&(q.isPending?<Spinner text="正在读取创作流程"/>:q.error?<ErrorState error={q.error} retry={()=>q.refetch()}/>:config&&q.data?<>
      <p className="muted">从设定拆解到批次细纲、逐章写作和章后归档。发布应用于之后启用流程的作品；已有作品与进行中的任务沿用各自版本。</p>
      <div className="s-creation-template-controls"><label>每批规划章数<input type="number" min={1} max={60} value={config.batch_size} disabled={busy} onChange={event=>{setDirty(true);setConfig({...config,batch_size:Number(event.target.value)});}}/></label><label>本次修改说明<input value={reason} onChange={event=>setReason(event.target.value)} minLength={2} maxLength={1000} placeholder="例如：细化人物动机检查，降低单步默认预算"/></label><span className="muted">已发布版本 {q.data.published_version||1} · {dirty?"有未保存修改":q.data.draft?"有待发布草稿":"已发布"}</span></div>
      <div className="s-creation-template-grid"><nav className="s-creation-template-nav" aria-label="创作流程阶段">{q.data.stages.map((stage,index)=><button key={stage.key} type="button" aria-current={current?.key===stage.key?"true":undefined} onClick={()=>setSelected(stage.key)}>{index+1}. {stage.label}</button>)}</nav>
        {current&&meta&&<div className="s-creation-template-editor"><h3>{meta.label}</h3><div className="s-creation-template-fields"><label>负责的智能体<select value={current.role} disabled={busy} onChange={event=>update({role:event.target.value})}>{q.data.roles.map(role=><option key={role.key} value={role.key}>{role.name}</option>)}</select></label><label>默认预算（点）<input type="number" min={1} max={10000} value={current.budget} disabled={busy} onChange={event=>update({budget:Number(event.target.value)})}/></label><label>输出上限（Token）<input type="number" min={512} max={32000} value={current.max_tokens} disabled={busy} onChange={event=>update({max_tokens:Number(event.target.value)})}/></label></div>
          <div><strong>必需输入</strong><ul>{meta.required_inputs.map((value,index)=><li key={index}>{q.data.stages.find(stage=>stage.key===value)?.label||value}</li>)}</ul><small className="muted">适用范围：{{project:"整本作品",book:"整本作品",chapter:"当前章节",batch:"当前批次"}[meta.scope]||meta.scope}。输入依赖与批准要求由服务端执行。</small></div>
          <label>这个阶段要怎样完成任务<textarea rows={8} minLength={20} maxLength={16000} value={current.instruction} disabled={busy} onChange={event=>update({instruction:event.target.value})}/></label>
          <label>质量检查要求（每行一项）<textarea rows={5} value={current.checks.join("\n")} disabled={busy} onChange={event=>update({checks:event.target.value.split("\n")})}/></label>
          <p className="muted">这里调整阶段任务；智能体的系统提示词、模型与工具权限继续在智能体编辑页管理。质量要求不能解除事实、版本与作者批准检查。</p>
        </div>}
      </div>
      {error&&<p className="error-text" role="alert">{error}</p>}
      <div className="s-creation-template-controls"><button className="button primary" disabled={busy||!dirty||reason.trim().length<2||!valid} onClick={save}>{busy?"正在处理…":"保存流程草稿"}</button><button className="button secondary" disabled={busy||dirty||!q.data.draft||reason.trim().length<2} onClick={()=>setPublishing(true)}>检查并发布</button><button className="button secondary" disabled={busy} onClick={()=>{setDirty(false);setError("");void q.refetch();}}>重新载入已保存内容</button></div>
      {reason.trim().length<2&&<p className="muted">填写至少两个字的修改说明后才能保存或发布。</p>}
      {!valid&&<p className="error-text">请检查：每批 1—60 章，任务要求 20—16000 字，检查要求最多 20 条，预算 1—10000 点，输出 512—32000 Token。</p>}
    </>:null)}
    {publishing&&<Modal title="发布这份创作流程" onClose={()=>setPublishing(false)} footer={<><button className="button secondary" disabled={busy} onClick={()=>setPublishing(false)}>返回检查</button><button className="button primary" disabled={busy||dirty||reason.trim().length<2} onClick={publish}>{busy?"正在发布…":"确认发布"}</button></>}><p>新启用流程的作品会使用这份模板。已有作品的设定、正文与任务版本不会自动改动。</p><p>每批 {config?.batch_size} 章，共 {config?.stages.length} 个阶段。</p><p>发布说明：{reason}</p>{error&&<p role="alert">{error}</p>}</Modal>}
  </details>;
}
