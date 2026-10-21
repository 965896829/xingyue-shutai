"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, CircleArrowLeft, Plus, Settings2 } from "lucide-react";

export function AgentEditorHeader({
  title, name, onClose, children,
}: {
  title: string; name?: string; onClose: () => void; children: ReactNode;
}) {
  return <div className="ref-editor-top">
    <button className="text-button" onClick={onClose}>
      <CircleArrowLeft size={20} />{title}
      {name && <span className="muted"> / {name}</span>}
    </button>
    <div>{children}</div>
  </div>;
}

export function AgentEditorColumns({ children }: { children: ReactNode }) {
  return <div className="ref-editor-columns">{children}</div>;
}

export function AgentEditorAccordion({
  title, icon, children, open = true, action, summary,
}: {
  title: string; icon?: ReactNode; children: ReactNode; open?: boolean;
  action?: () => void; summary?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(open);
  return <section className="ref-accordion">
    <div className="ref-accordion-heading">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        {icon}<span>{title}</span>{!expanded && summary}
      </button>
      {action && <button type="button" className="icon-button" aria-label={`添加${title}`} onClick={action}><Plus size={16} /></button>}
      <button type="button" className="icon-button" aria-label={`${expanded ? "收起" : "展开"}${title}`} onClick={() => setExpanded(!expanded)}>
        <ChevronDown size={15} style={{ transform: expanded ? "none" : "rotate(-90deg)" }} />
      </button>
    </div>
    {expanded && <div className="ref-accordion-body">{children}</div>}
  </section>;
}

export function AgentModelChoice({ value, onChange, onSettings, disabled, children }: {
  value: string; onChange: (value: string) => void; onSettings: () => void;
  disabled?: boolean; children: ReactNode;
}) {
  return <div className="ref-model-choice">
    <span>大模型 <b>*</b></span>
    <select aria-label="大模型" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{children}</select>
    <button type="button" className="icon-button" aria-label="模型参数设置" onClick={onSettings}><Settings2 size={17} /></button>
  </div>;
}

const templates = [
  {
    name: "通用结构",
    description: "适用于多种场景的提示词结构，可根据具体需求增删模块。",
    text: "角色：\n你是一位专业的网文创作助手。\n\n目标：\n根据作者提供的资料，完成当前创作任务。\n\n约束：\n尊重已确认的设定，区分事实与建议，不擅自改写正史。\n\n输出格式：\n清楚的正文或结构化建议。",
  },
  {
    name: "任务执行",
    description: "适用于有明确步骤的任务，说明每一步的工作要求。",
    text: "任务：\n\n输入资料：\n\n执行步骤：\n1. 核对任务和资料边界。\n2. 完成当前步骤，保留依据。\n3. 检查结果，列出需要作者决定的问题。\n\n验收标准：",
  },
  {
    name: "角色扮演",
    description: "用于人物对话与角色塑造，明确身份、语气与知识边界。",
    text: "人物身份：\n\n性格与语气：\n\n人物已知信息：\n\n对话目标：\n\n限制：不使用人物尚未知晓的事实。",
  },
];

export function AgentPromptTemplates({ onAppend }: { onAppend: (text: string) => void }) {
  return <>
    <span className="ref-recommend-title">推荐</span>
    <div className="ref-prompt-templates">{templates.map(t => <button key={t.name} type="button" onClick={() => onAppend(t.text)}>
      <strong>{t.name}</strong><p>{t.description}</p>
    </button>)}</div>
  </>;
}
