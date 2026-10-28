import type { Dimension } from './studio';
import { sceneEstimate, type NarrativeScene } from './narrative-playback';

export type NarrativeDimension = 'intensity' | Dimension;
export const narrativeDimensionNames: Record<NarrativeDimension, string> = { intensity: '情节强度', pressure: '叙事压力', payoff: '回报兑现', emotion: '情绪强度', revelation: '信息揭示', relationship: '关系变化' };
export function sceneDimension(scene: NarrativeScene, dimension: NarrativeDimension) {
  if (dimension === 'intensity') return sceneEstimate(scene);
  const text = `${scene.title}\n${scene.content.replace(/^[^\n：:]{1,35}[：:]\s*/gm, '')}`.replace(/(?:不再|没有|不会|避免|禁止|不必|不得|不能|未曾|无需)[^，。；;\n]{0,18}/g, '');
  const rules: Record<Dimension, [RegExp, number][]> = {
    pressure: [[/决战|生死关头|必死|濒死/, 5], [/倒计时|不可逆|最后.{0,5}机会|绝境|围攻|追杀/, 4], [/风险|代价|阻碍|扣住|要求|不足|不够|承担/, 3], [/准备|目标|安排/, 2], [/平静|休息|无即时对抗/, 1]],
    payoff: [[/核心承诺.{0,8}兑现|大仇得报/, 5], [/通过结算|保住|恢复供水|重要阶段.{0,5}兑现/, 4], [/兑现|取得|交出|打开|接收|通过/, 3], [/推进|准备|核对|检查/, 2]],
    emotion: [[/情绪崩溃|绝望|痛不欲生/, 5], [/恐惧|愤怒|狂喜|悲痛/, 4], [/焦急|激动|不满|怀疑|感谢|失望/, 3], [/平静|克制|犹豫|休息|放心/, 2]],
    revelation: [[/终极真相|身份彻底揭露/, 5], [/揭开|真相|身份揭露/, 4], [/查明|读到|确认|发现|揭示|公告说明/, 3], [/线索|图线|悬念|尚未确认/, 2]],
    relationship: [[/生死决裂|背叛|反目成仇/, 5], [/结盟|关系逆转|决裂/, 4], [/合作成立|取得.{0,6}信任|有限合作|签认|共担/, 3], [/支持|协作|质疑|争执|让步/, 2]]
  };
  const matched = rules[dimension].find(([pattern]) => pattern.test(text));
  return matched ? { value: matched[1], estimated: true, reason: `细纲包含“${text.match(matched[0])?.[0]}”等线索（本地规则预估）` } :
    { value: null, estimated: true, reason: '没有足够线索估计这一维度' };
}
