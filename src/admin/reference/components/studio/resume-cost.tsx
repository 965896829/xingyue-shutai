"use client";

export type ResumeQuote = {
  quote_token: string;
  run_version: number;
  spent_credits: number;
  authorized_total: number;
  remaining_authorized: number;
  recommended_total_limit: number;
  minimum_credits: number;
  maximum_credits: number;
  minimum_budget: number;
  maximum_budget: number;
  available_credits: number;
  billing_source: "platform" | "personal_api";
  environment: string;
  can_resume: boolean;
  steps: { key: string; label: string; calls: number; conditional: boolean }[];
};

export function continuationChoice(quote: ResumeQuote, totalLimit: number) {
  const personal = quote.billing_source === "personal_api";
  const budget = totalLimit - quote.spent_credits;
  const additional = personal ? 0 : Math.max(0, totalLimit - quote.authorized_total);
  const error = personal ? "" : !Number.isSafeInteger(totalLimit) || budget < quote.minimum_budget
    ? "这个上限不足以开始下一步，请采用推荐上限。"
    : budget > quote.maximum_budget ? "所需额度超过当前流程允许的上限，请联系管理员调整。"
    : budget > quote.available_credits ? "可用点数或作品额度不足，请补充后继续，或调整自定义上限。" : "";
  return { personal, additional, error };
}

export function ResumeCost({ quote, limit, custom, onChange, busy }: {
  quote: ResumeQuote; limit: number; custom: boolean; onChange: (value: number | null) => void; busy: boolean;
}) {
  const choice = continuationChoice(quote, limit);
  const required = quote.steps.filter(step => !step.conditional);
  const optional = quote.steps.some(step => step.conditional);
  return <section className="s-resume-cost" aria-label="剩余工作与预计费用">
    <strong>接下来要完成</strong>
    <ul>{required.map((step, index) => <li key={`${step.key}:${index}`}>{step.label}</li>)}</ul>
    {choice.personal ? <p>使用原来的个人 API，不扣平台点数。服务商按实际调用收费，暂无法预估金额。</p> : <>
      <p><strong>{quote.environment === "sandbox" ? "演示模式 · 不产生模型费用" : `预计还需 ${quote.minimum_credits}–${quote.maximum_credits} 点`}</strong></p>
      <p>本次任务累计已用 {quote.spent_credits} 点，原授权上限 {quote.authorized_total} 点。</p>
      <p>{choice.additional > 0
        ? `${custom ? "将" : "建议将"}任务总上限调整至 ${limit} 点，本次追加授权 ${choice.additional} 点。`
        : `${custom ? "本次采用" : "继续沿用"}任务总上限 ${limit} 点，无需追加授权。`}</p>
      <details>
        <summary>自定义费用上限</summary>
        <label className="field">本次任务总上限（含已用点数）
          <input type="number" min={quote.spent_credits + quote.minimum_budget}
            max={quote.spent_credits + quote.maximum_budget} value={limit} disabled={busy}
            onChange={event => onChange(Number(event.target.value))} />
        </label>
        {custom && <button type="button" className="s-text-button" disabled={busy} onClick={() => onChange(null)}>使用推荐上限</button>}
      </details>
      {limit - quote.spent_credits < quote.maximum_credits && !choice.error && <p className="s-warning">所选额度低于预计用量上沿，可能仍需追加后才能完成。</p>}
      {choice.error && <p className="s-warning" role="alert">{choice.error}</p>}
      <small>按实际用量结算，达到上限后会保留进度并等待确认。{optional ? "预估包含可能需要的修正与复查。" : "工具调用与内容修正可能增加用量。"}</small>
    </>}
    <p className="s-note">沿用原任务的模型与思考设置。</p>
  </section>;
}
