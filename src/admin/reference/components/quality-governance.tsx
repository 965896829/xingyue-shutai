"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, put, authorLabel } from "@reference/lib/api";
import { Spinner } from "./ui";
import "./quality-governance.css";

const root = "/admin/quality-governance";
const names: Record<string,string> = {baseline:"当前稳定版",target:"待发布版本",train:"调试组",holdout:"独立检验组",false_positive:"误报比例",false_negative:"漏报比例",insufficient:"依据不足比例",accuracy:"与参考结论一致率",order_bias:"调换顺序后的分歧比例",length_bias:"错误偏爱较长文字的比例",self_bias:"错误偏爱自己作品的比例",works:"作品数",authors:"作者数",length_controls:"长度对照次数",self_controls:"自评对照次数",eligible:"达到门槛",A:"写法 A",B:"写法 B",tie:"同样合适",pass:"通过",issue:"有问题",conflict:"与原文不符"};
const blankRule = () => ({case_id:"",rule_id:"",contract:"",problem_text:"",contrast_text:"",reason:""});
const blankReviewer = () => ({case_id:"",work_key:"",author_key:"",split:"train",contract:"",a_text:"",b_text:"",a_model:"",b_model:"",expected:"tie",reason:""});
const caseSignature = (values:any[]) => JSON.stringify(values.map(v=>Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)))));

export function QualityGovernance(){
  const cache=useQueryClient();
  const q=useQuery({queryKey:["quality-governance"],queryFn:()=>api(root)});
  const releases=useQuery({queryKey:["rule-releases"],queryFn:()=>api("/admin/rules/releases"),enabled:!!q.data});
  const models=useQuery({queryKey:["quality-models"],queryFn:()=>api("/creation/options"),enabled:!!q.data});
  const [kind,setKind]=useState("rule-quality"),[sid,setSid]=useState(""),[version,setVersion]=useState(0),[name,setName]=useState(""),[cases,setCases]=useState<any[]>([blankRule()]),[authorized,setAuthorized]=useState(false);
  const [model,setModel]=useState(""),[target,setTarget]=useState(""),[budget,setBudget]=useState(100),[runId,setRunId]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[reason,setReason]=useState(""),[routeResult,setRouteResult]=useState("");
  const run=useQuery({queryKey:["quality-run",runId],queryFn:()=>api(`/runs/${runId}`),enabled:!!runId,refetchInterval:(query)=>["queued","running"].includes((query.state.data as any)?.state)?2000:false});
  useEffect(()=>{if(run.data&&!['queued','running'].includes(run.data.state)){cache.invalidateQueries({queryKey:["quality-governance"]});if(run.data.state==='succeeded')setMessage('检查结果已保存');}},[run.data?.state,cache]);
  const effectiveModel=model||(models.data?.models||[]).find((m:any)=>m.available)?.id||"";
  const savedSuite=q.data?.suites.find((s:any)=>s.id===sid);
  const dirty=!!sid&&(!savedSuite||savedSuite.name!==name||caseSignature(savedSuite.cases)!==caseSignature(cases));
  async function action(fn:()=>Promise<any>){setBusy(true);setMessage("");try{await fn();await cache.invalidateQueries({queryKey:["quality-governance"]});}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  function load(id:string,nextKind=kind){setSid(id);const suite=q.data?.suites.find((s:any)=>s.id===id);setVersion(suite?.version||0);setName(suite?.name||"");setCases(suite?.cases||[nextKind==='rule-quality'?blankRule():blankReviewer()]);setAuthorized(false);}
  function change(index:number,key:string,value:string){setCases(cases.map((c,i)=>i===index?{...c,[key]:value}:c));}
  if(q.isPending)return <Spinner/>;
  if(q.error)return <p>查看规则质量与审稿校准需要规则管理权限。</p>;
  const results=(q.data.results||[]).filter((r:any)=>r.purpose===kind);
  return <section className="pw-card quality-governance"><h3>规则质量与审稿模型</h3>
    <div className="quality-tabs">{[["rule-quality","规则正反例检查"],["review-calibration","审稿模型校准"]].map(([key,label])=><button type="button" key={key} aria-pressed={kind===key} onClick={()=>{setKind(key);load("",key);}}>{label}</button>)}</div>
    <label>检查样例<select value={sid} onChange={e=>load(e.target.value)}><option value="">新建一组样例</option>{q.data.suites.filter((s:any)=>s.purpose===kind).map((s:any)=><option key={s.id} value={s.id}>{s.name} · 第 {s.version} 版</option>)}</select></label>
    {kind==='rule-quality'&&<button className="mw-button" disabled={busy} onClick={()=>action(async()=>{const r=await post(root+'/rule-examples',{});const fresh=await q.refetch();const s=fresh.data.suites.find((s:any)=>s.id===r.id);setSid(r.id);setVersion(r.version);setName(s.name);setCases(s.cases);setMessage('内置正反例已载入');})}>载入内置规则样例</button>}
    <details open={!sid}><summary>编辑检查样例</summary>
      {kind==='review-calibration'&&<p>调试组和独立检验组各准备至少两部作品、两位作者，作者和作品不能跨组重复。每组需包含长短写法的对照，以及检查模型自己生成的写法。</p>}
      <label>这组样例的名称<input value={name} onChange={e=>setName(e.target.value)} maxLength={100}/></label>
      {cases.map((c,index)=><fieldset key={index} style={{minWidth:0,marginBlock:12}}><legend>样例 {index+1}</legend>
        <label>样例名称<input value={c.case_id} onChange={e=>change(index,'case_id',e.target.value)}/></label>
        {kind==='rule-quality'?<label>对应规则编号<input value={c.rule_id} onChange={e=>change(index,'rule_id',e.target.value)}/></label>:<div className="mw-grid">
          <label>作品标记<input value={c.work_key} onChange={e=>change(index,'work_key',e.target.value)}/></label><label>作者标记<input value={c.author_key} onChange={e=>change(index,'author_key',e.target.value)}/></label>
          <label>用途<select value={c.split} onChange={e=>change(index,'split',e.target.value)}><option value="train">调试</option><option value="holdout">独立检验</option></select></label></div>}
        <label>已知设定和判断要求<textarea value={c.contract} onChange={e=>change(index,'contract',e.target.value)} rows={2}/></label>
        {(kind==='rule-quality'?[["problem_text","确实有问题的写法"],["contrast_text","合理的写法"]]:[["a_text","写法 A"],["b_text","写法 B"]]).map(([key,label])=><label key={key}>{label}<textarea value={c[key]} onChange={e=>change(index,key,e.target.value)} rows={3}/></label>)}
        {kind==='review-calibration'&&<div className="mw-grid"><label>写法 A 的生成模型<input value={c.a_model} onChange={e=>change(index,'a_model',e.target.value)}/></label><label>写法 B 的生成模型<input value={c.b_model} onChange={e=>change(index,'b_model',e.target.value)}/></label><label>人工参考结论<select value={c.expected} onChange={e=>change(index,'expected',e.target.value)}><option value="A">写法 A 更合适</option><option value="B">写法 B 更合适</option><option value="tie">同样合适</option></select></label></div>}
        <label>判断原因<textarea value={c.reason} onChange={e=>change(index,'reason',e.target.value)} rows={2}/></label>
        <button className="mw-button" disabled={cases.length<=1} onClick={()=>setCases(cases.filter((_,i)=>i!==index))}>删除这条样例</button>
      </fieldset>)}
      <button className="mw-button" disabled={cases.length>=100} onClick={()=>setCases([...cases,kind==='rule-quality'?blankRule():blankReviewer()])}>增加样例</button>
      <label><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/>我有权将这些文字用于平台质量检查</label>
      <button className="mw-button" disabled={busy||!name.trim()||!authorized} onClick={()=>action(async()=>{const body={name,kind,cases,authorized,expected_version:version};const r=sid?await put(`${root}/suites/${sid}`,body):await post(root+'/suites',body);setSid(sid||r.id);setVersion(r.version);setMessage('检查样例已保存');})}>保存样例</button>
    </details>
    <div className="mw-grid"><label>检查模型<select value={effectiveModel} onChange={e=>setModel(e.target.value)}><option value="">请选择模型</option>{(models.data?.models||[]).filter((m:any)=>m.available).map((m:any)=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      {kind==='rule-quality'&&<label>待验证的规则版本<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">请选择草案</option>{(releases.data?.items||[]).filter((r:any)=>['draft','canary'].includes(r.state)).map((r:any)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
      <label>本次费用上限（点）<input type="number" min={1} max={10000} value={budget} onChange={e=>setBudget(Number(e.target.value))}/></label></div>
    {dirty&&<p role="status">样例还有修改未保存，请先保存。</p>}
    {!sid&&<p>先保存一组检查样例。</p>}
    {!!sid&&kind==='rule-quality'&&!target&&<p>请选择待验证版本；没有草案时，可在规则管理中复制当前版本。</p>}
    <button className="mw-button" disabled={busy||dirty||!sid||!effectiveModel||(kind==='rule-quality'&&!target)||!Number.isInteger(budget)||budget<1||budget>10000} onClick={()=>action(async()=>{const r=await post(root+'/runs',{suite_id:sid,model:effectiveModel,target_release:kind==='rule-quality'?target:null,budget});setRunId(r.id);setMessage('检查已开始');})}>开始检查</button>
    {run.data&&<p role="status">{authorLabel(run.data.state)} · 已用 {run.data.actual_cost} 点 {run.data.error||''}{['queued','running'].includes(run.data.state)&&<button className="mw-button" onClick={()=>action(async()=>{await post(`/runs/${runId}/cancel`,{});await run.refetch();})}>停止检查</button>}{['failed','cancelled','paused_budget'].includes(run.data.state)&&<button className="mw-button" onClick={()=>action(async()=>{const r=await post(`/runs/${runId}/resume`,{budget,expected_version:run.data.version});setRunId(r.id);})}>接着检查</button>}</p>}
    {run.error&&<p role="alert">{run.error.message}</p>}
    <p role="status">{message}</p><h4>检查结果</h4>
    {!results.length&&<p>还没有检查结果。保存样例后即可开始。</p>}
    {results.map((r:any)=><details key={r.id}><summary>{r.name} · {r.model_snapshot.model} · {r.current===false?'依据已变化，请重新检查':r.simulated?'演示结果':r.status==='approved'?'已人工确认':r.eligible?'可提交确认':'未达到门槛'}</summary>
      <p>样例第 {r.suite_version} 版 · 模型配置第 {r.model_snapshot.version} 版 · {r.evaluated_count} 次判断</p>
      {r.simulated&&<p>演示结果仅用于检查流程。选择真实模型后重新检查，才能提交人工确认。<a href="/admin/platform/platforms">配置模型接口</a></p>}
      {Object.entries(r.metrics).map(([arm,metrics]:[string,any])=><div key={arm}><strong>{names[arm]||arm}</strong><dl>{Object.entries(metrics).map(([key,value])=><div key={key}><dt>{names[key]||key}</dt><dd>{value===null?'缺少对照样例':typeof value==='boolean'?(value?'是':'否'):typeof value==='number'?Number(value.toFixed(3)):String(value)}</dd></div>)}</dl></div>)}
      <details><summary>逐条判断及原因</summary>{(Array.isArray(r.observations)?r.observations:Object.entries(r.observations).flatMap(([arm,rows]:[string,any])=>rows.map((v:any)=>({...v,arm})))).map((o:any,i:number)=><p key={i}>{o.case_id} · {o.arm?names[o.arm]:o.reversed?'调换顺序':'原顺序'}：{o.reason||`问题写法：${names[o.problem?.status]||o.problem?.status}，${o.problem?.reason}；合理写法：${names[o.contrast?.status]||o.contrast?.status}，${o.contrast?.reason}`}</p>)}</details>
      {r.current!==false&&r.eligible&&r.status!=='approved'&&<><label>人工复核意见<input value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="mw-button" disabled={busy||reason.trim().length<5} onClick={()=>action(async()=>{await post(`${root}/results/${r.id}/approve`,{reason});setMessage('检查结果已确认');})}>确认这份检查结果</button></>}
    </details>)}
    {kind==='review-calibration'&&<div><h4>审稿模型选择</h4><p>{q.data.routing.enabled?`当前审稿模型：${q.data.routing.model}`:'当前沿用每次创作选择的模型'}</p><select aria-label="已确认的校准结果" value={routeResult} onChange={e=>setRouteResult(e.target.value)}><option value="">请选择已确认的结果</option>{results.filter((r:any)=>r.current!==false&&r.status==='approved'&&r.eligible).map((r:any)=><option key={r.id} value={r.id}>{r.model_snapshot.model} · 样例第 {r.suite_version} 版</option>)}</select><button className="mw-button" disabled={busy||!routeResult} onClick={()=>action(async()=>{await put(root+'/reviewer-routing',{enabled:true,result_id:routeResult,expected_version:q.data.routing.version});setMessage('审稿模型已更新');})}>用于后续审稿</button><button className="mw-button" disabled={busy||!q.data.routing.enabled} onClick={()=>action(async()=>{await put(root+'/reviewer-routing',{enabled:false,result_id:null,expected_version:q.data.routing.version});setMessage('已恢复使用每次创作选择的模型');})}>恢复原来的模型选择</button></div>}
  </section>;
}
