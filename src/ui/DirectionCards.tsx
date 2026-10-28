import type { PlanningReport } from '../shared/tags';

export function DirectionCards({ report, selectedId, disabled, onSelect, format }: {
  report: PlanningReport;
  selectedId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  format: (text: string) => string;
}) {
  return <div className="tag-directions">
    {report.directions.map(direction => {
      const additions = report.assumptions.filter(item => !item.directionIds.length || item.directionIds.includes(direction.id));
      const selected = selectedId === direction.id;
      return <article key={direction.id} className={selected ? 'selected' : ''} aria-label={format(direction.title)}>
        {report.recommendedDirectionId === direction.id && <span className="creation-badge">推荐方向</span>}
        <h3>{format(direction.title)}</h3>
        <p>{format(direction.logline)}</p>
        <dl>
          <dt>开篇怎么抓人</dt><dd>{format(direction.openingDecision)}</dd>
          <dt>故事如何持续展开</dt><dd>{format(direction.storyEngine)}</dd>
          <dt>第一卷会发生什么变化</dt><dd>{format(direction.firstVolumeChange)}</dd>
          <dt>与另外两案的区别</dt><dd>{format(direction.differenceFromOtherDirections)}</dd>
          <dt>长期风险与应对</dt><dd>{format(direction.longRunRisk)}</dd>
        </dl>
        <section className="direction-settings" aria-label={`${format(direction.title)}的新增设定`}>
          <h4>模型新增设定</h4>
          {additions.length ? <>
            <p className="muted">模型提出的补充设定，以你最终确认的方案为准。</p>
            <ul>{additions.map(item => <li key={item.id}>{format(item.text)}</li>)}</ul>
          </> : <p className="muted">本案未单列新增设定。</p>}
          {!!direction.intentChanges.length && <>
            <h4>对原创意的调整</h4>
            <ul>{direction.intentChanges.map((text, index) => <li key={index}>{format(text)}</li>)}</ul>
          </>}
        </section>
        <button disabled={disabled} aria-pressed={selected} onClick={() => onSelect(direction.id)}>
          {selected ? '已选这个方向' : '选择这个方向'}
        </button>
      </article>;
    })}
  </div>;
}
