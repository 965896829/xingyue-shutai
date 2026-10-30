import type { WritingStyleReport } from '../../src/shared/writing-style';

export const writingStyleReportFixture: WritingStyleReport = {
  recommendedId: 'tension',
  options: [
    { id: 'tension', name: '行动悬念型', style: '清晰克制；用人物行动与可观察细节呈现疑问；线索逐步兑现；紧张与松弛交替',
      reason: '维修员调查异常的设定适合让读者跟随行动发现线索，突出职业观察和阅读期待。', tradeoff: '需要及时兑现线索，避免连续隐藏关键信息。' },
    { id: 'warm', name: '生活质感型', style: '语言自然；从具体生活细节和人物互动建立现场感；以关系变化承接悬念',
      reason: '日常细节可以建立人物可信度，让异常更有反差。', tradeoff: '开篇需要尽早出现有效变化，控制铺陈。' },
    { id: 'brisk', name: '轻快对白型', style: '短句与自然对白交替；用人物之间的反差制造轻微幽默；关键冲突保持真实分量',
      reason: '人物互动能降低说明负担，适合带有伙伴关系的故事。', tradeoff: '幽默应服从角色处境，避免削弱危险感。' }
  ]
};
