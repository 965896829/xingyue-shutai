"use client";
import { DeleteButton } from "./interaction/delete-button";
export const taskFields: Record<string, string> = {
  start_state: "起始局面",
  objective: "本场目标",
  resistance: "阻力 / 对立",
  choice: "必须面对的选择",
  cost: "为此付出什么代价",
  scene_function: "这场戏要起什么作用",
  end_state: "结束状态",
  bridge: "与下一场的承接",
  allowed_reveals: "允许揭示",
  forbidden_reveals: "禁止揭示",
  story_time: "故事时间",
  genre_notes: "题材重点",
};
export const blankTask = () => ({
  start_state: "",
  objective: "",
  resistance: "",
  choice: "",
  end_state: "",
  bridge: "",
  allowed_reveals: "",
  forbidden_reveals: "",
  story_time: "",
  location_id: null,
  pov_id: null,
  cast_ids: [],
  words_min: 1500,
  words_max: 3000,
  genre_module: "general",
  genre_notes: "",
  locked_fields: [],
});
const genreNotes: Record<string, string> = {
  general: "行动产生后果；场景结束后局面改变。",
  fantasy: "能力限制、代价与资源变化；不越过已确认的等级规则。",
  urban: "社会关系、利益与现实约束；职业细节需要依据。",
  suspense: "线索可追溯、公平揭示、人物知道与读者知道分开。",
  romance: "情感变化由行动触发；保留人物边界与关系进展的因果。",
};
export function SceneTaskEditor({
  value,
  change,
  entities,
}: {
  value: any;
  change: (v: any) => void;
  entities: any[];
}) {
  const update = (v: any) => change({ ...value, ...v });
  return (
    <details open={!!value}>
      <summary>这一场怎么写</summary>
      {!value ? (
        <button className="mw-button" onClick={() => change(blankTask())}>
          安排这一场
        </button>
      ) : (
        <>
          <div className="mw-grid">
            {Object.entries(taskFields).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  aria-label={label}
                  rows={2}
                  value={value[key] || ""}
                  onChange={(e) => update({ [key]: e.target.value })}
                />
                <span className="mw-check">
                  <input
                    aria-label={`锁定${label}`}
                    type="checkbox"
                    checked={value.locked_fields.includes(key)}
                    onChange={(e) =>
                      update({
                        locked_fields: e.target.checked
                          ? [...value.locked_fields, key]
                          : value.locked_fields.filter(
                              (x: string) => x !== key,
                            ),
                      })
                    }
                  />
                  锁定此项
                </span>
              </label>
            ))}
            <label>
              题材模块
              <select
                aria-label="题材模块"
                value={value.genre_module}
                onChange={(e) =>
                  update({
                    genre_module: e.target.value,
                    genre_notes: genreNotes[e.target.value],
                  })
                }
              >
                {Object.entries({
                  general: "通用",
                  fantasy: "玄幻",
                  urban: "都市",
                  suspense: "悬疑",
                  romance: "言情",
                }).map(([k, n]) => (
                  <option value={k} key={k}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {[
              ["pov_id", "视角人物", "character"],
              ["location_id", "地点", "location"],
            ].map(([key, label, type]) => (
              <label key={key}>
                {label}
                <select
                  aria-label={label}
                  value={value[key] || ""}
                  onChange={(e) => update({ [key]: e.target.value || null })}
                >
                  <option value="">未限定</option>
                  {entities
                    .filter((x) => x.type === type)
                    .map((x) => (
                      <option value={x.id} key={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <label>
              参与人物
              <select
                aria-label="参与人物"
                multiple
                value={value.cast_ids}
                onChange={(e) =>
                  update({
                    cast_ids: Array.from(e.target.selectedOptions).map(
                      (o) => o.value,
                    ),
                  })
                }
              >
                {entities
                  .filter((x) => x.type === "character")
                  .map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            {[
              ["words_min", "目标字数下限"],
              ["words_max", "目标字数上限"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={50}
                  max={30000}
                  value={value[key]}
                  onChange={(e) => update({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <label>
            本场要发生的事（每行一项）
            <textarea
              aria-label="本场要发生的事（每行一项）"
              rows={4}
              value={(value.beats || []).join("\n")}
              onChange={(e) => update({ beats: e.target.value.split("\n") })}
            />
          </label>
          <DeleteButton
            confirmation="inline"
            className="mw-button"
            onClick={() => change(null)}
          >
            移除任务书（锁定项仍需授权）
          </DeleteButton>
        </>
      )}
    </details>
  );
}
