export const playbackPlan = `# 第001章细纲

- 情节强度：4/5。
- 本章主要阅读回报：修好水泵，让居民得到干净的水。

## 场面1：发现故障
- 地点：泵房门口。
- 动作/对话推进：林川检查压力表，发现供水中断，决定打开检修口。
- 小钩子：压力表背后还藏着一段记录。

## 场面2：一起抢修
- 地点：地下泵房。
- 动作/对话推进：林川与周宁协作拆下旧阀门，排出积水，再核对管线。
- 阅读回报：找到漏点，居民送来工具。

## 场面3：兑现回报
- 地点：楼内取水处。
- 动作/对话推进：周宁拿来水桶，水泵重新转动，林川公开登记供水安排。
- 余波/状态变化：居民终于能够喝上清水，维修队获得信任。

## 场面4：新的线索
- 地点：泵房值班室。
- 动作/对话推进：林川翻到旧记录的最后一页，看见另一条陌生管线。
- 小钩子：那条管线通向地图上没有标注的房间。
`;
export const playbackProse = '# 第001章 水泵重新转动\n\n' + Array.from({ length: 28 }, (_, i) => {
  const parts = [
    '林川站在泵房门口，先看压力表，再沿着墙边寻找检修口。供水刚刚中断，门外已经有人在等。',
    '周宁把工具放在地下泵房的干地上，两人协作拆下旧阀门。积水慢慢退去，管线上的漏点终于露了出来。',
    '水泵重新转动，楼内取水处传来欢呼。周宁拿来水桶，林川把供水安排写进记录，居民终于喝上了清水。',
    '值班室安静下来。林川翻到旧记录的最后一页，发现另一条陌生管线，它通向地图上没有标注的房间。'
  ];
  return parts[Math.floor(i / 7)] + `他把第${i + 1}项检查结果留下，确认每一个阀门的位置和负责的人。` + (i === 4 ? '标签上写着𠮷，旁边画了一只👩‍🔧。' : '') + '事情还没有结束，但眼前这一步已经有了明确的结果。';
}).join('\n\n');

/** Same-response event stream: only the transport envelope has these comments. */
const playbackNodes = [
  { paragraph: 0, kind: 'beat', label: '供水中断', intensity: 2, emotion: '平静→担忧', valence: -1 },
  { paragraph: 5, kind: 'reversal', label: '检修口被封', intensity: 4, emotion: '疑虑→紧张', valence: -2 },
  { paragraph: 10, kind: 'climax', label: '抢修漏点', intensity: 5, emotion: '紧张→焦灼', valence: -1 },
  { paragraph: 16, kind: 'payoff', label: '清水送到家', intensity: 4, emotion: '焦灼→喜悦', valence: 2 },
  { paragraph: 20, kind: 'release', label: '泵房安静下来', intensity: 1, emotion: '喜悦→安定', valence: 1 },
  { paragraph: 25, kind: 'hook', label: '地图外的房间', intensity: 3, emotion: '安定→疑虑', valence: -1 }
];
export const playbackResponse = playbackProse.split('\n\n').map((paragraph, i) => {
  const node = playbackNodes.find(node => node.paragraph === i - 1);
  if (!node) return paragraph;
  const { paragraph: _index, ...data } = node;
  return paragraph + `<!--wenxu-event:${JSON.stringify({ ...data, anchor: paragraph.slice(paragraph.indexOf('他把第'), paragraph.indexOf('他把第') + 30) })}-->`;
}).join('\n\n');

