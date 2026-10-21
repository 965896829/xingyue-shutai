"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, put, type DataRecord } from "@reference/lib/api";

type Controls={skill_release_id:string;recall_top_k:number;recall_characters:number;model_turn_limit:number;tool_call_limit:number};
type Runtime={enabled:boolean;settings:Controls&{version:number};skill:{name:string;sha256:string;release_id:string;trusted_scripts:string[]};
  files:{path:string;characters:number}[];releases:{id:string;name:string;version:number;files:number}[]};

export function WritingRuntimePanel({skills}:{skills:DataRecord[]}) {
  const cache=useQueryClient(),q=useQuery<Runtime>({queryKey:["writing-runtime"],queryFn:()=>api("/admin/writing-runtime")});
  const [draft,setDraft]=useState<Controls|null>(null),[skillId,setSkillId]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [dirty,setDirty]=useState(false),baseVersion=useRef(0);
  useEffect(()=>{if(q.data&&!dirty){const {version,...values}=q.data.settings;baseVersion.current=version;setDraft(values);}},[q.data,dirty]);
  function edit(value:Controls){setDraft(value);setDirty(true);}
  async function perform(fn:()=>Promise<unknown>,saved=false){setBusy(true);setError("");try{await fn();if(saved)setDirty(false);await cache.invalidateQueries({queryKey:["writing-runtime"]});}
    catch(e){setError(e instanceof Error?e.message:"操作失败");}finally{setBusy(false);}}
  if(q.isPending)return <p>正在读取写作执行配置…</p>;
  if(q.error)return <section className="ref-box"><strong>内置技能已接入</strong><p>下方显示客户端安装包中的实际技能。进入作品的写作流程可选择并执行技能。</p><p className="muted">原平台的 Skill 上传、发布与执行器切换尚未接入；本机技能随客户端版本更新。</p><a className="button secondary" href="#/admin/novel/workflows">前往写作流程</a></section>;
  if(!q.data||!draft)return null;
  const data=q.data;
  return <section className="ref-card" style={{padding:20,marginBottom:20}} aria-label="写作执行管理">
    <div className="ref-toolbar"><h2>写作执行</h2><span>{data.enabled?"Codex 执行已启用":"执行器未启用"}</span></div>
    <label>当前 Skill 版本 <select aria-label="写作使用的 Skill" value={draft.skill_release_id} disabled={busy}
      onChange={e=>edit({...draft,skill_release_id:e.target.value})}>
      <option value="">内置 · 网文神设成章</option>{data.releases.map(row=><option key={row.id} value={row.id}>{row.name} · 第 {row.version} 版 · {row.files} 个文件</option>)}
    </select></label>
    <details style={{marginTop:14}}><summary>检索与执行设置</summary>
      <div className="form-grid" style={{marginTop:12}}>
        {([['recall_top_k','每轮相关片段',1,24],['recall_characters','检索字符上限',2000,30000],
          ['model_turn_limit','单轮模型调用上限',2,30],['tool_call_limit','单轮工具调用上限',8,128]] as const).map(([key,label,min,max])=>
          <label key={key}>{label}<input type="number" aria-label={label} value={draft[key]} min={min} max={max} disabled={busy}
            onChange={e=>edit({...draft,[key]:Number(e.target.value)})}/></label>)}
      </div>
    </details>
    <div className="ref-toolbar" style={{marginTop:14}}><button className="button primary" disabled={busy}
      onClick={()=>void perform(()=>put("/admin/writing-runtime",{expected_version:baseVersion.current,settings:draft}),true)}>保存执行配置</button>
      <small>新任务使用新配置；进行中的任务沿用已固定版本。</small></div>
    <details style={{marginTop:14}}><summary>当前资源 · {data.files.length} 个文件 · {data.skill.trusted_scripts.length} 个受控脚本</summary>
      <ul style={{maxHeight:200,overflow:"auto"}}>{data.files.map(file=><li key={file.path}>{file.path} · {file.characters} 字符</li>)}</ul>
      <small>版本校验值：{data.skill.sha256.slice(0,16)}</small>
    </details>
    <div className="ref-toolbar" style={{marginTop:18}}>
      <select aria-label="准备发布的 Skill" value={skillId} disabled={busy} onChange={e=>setSkillId(e.target.value)}>
        <option value="">选择已上传的 Skill</option>{skills.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      <button className="button secondary" disabled={busy||!skills.some(row=>row.id===skillId)} onClick={()=>void perform(async()=>{
        const row=skills.find(row=>row.id===skillId)!;
        await post("/admin/writing-runtime/releases",{skill_id:row.id,expected_version:row.version});
      })}>发布为可用版本</button>
    </div>
    {error&&<><p role="alert">{error}</p><button className="button secondary" disabled={busy} onClick={()=>{setDirty(false);void q.refetch();}}>重新读取配置</button></>}
  </section>;
}
