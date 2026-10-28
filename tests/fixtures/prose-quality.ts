import type { EditorialFinding } from '../../src/core/prose-editorial';

// Original synthetic passages. They test narrowly defined textual signals, not
// literary merit, AI authorship, copyright clearance or a model's writing skill.
export interface ProseQualityCase { id: string; genre: string; text: string; recent?: string[]; signals: EditorialFinding['code'][] }
export const overlapParagraph = '顾平安把黑色权证压在玻璃下，绕到柜台另一边看了一遍。持有人那栏没有变，只有边角的编号在灯下露出一道被刀刮过的白痕。';
const ending = '他不知道的是，真正的考验才刚刚开始。';
export const proseQualityCases: ProseQualityCase[] = [
  { id: 'duplicate-body', genre: '规则悬疑', text: `${overlapParagraph}\n\n柜台里传来敲击声。\n\n${overlapParagraph}`, signals: ['repeated_paragraph'] },
  { id: 'recent-copy', genre: '规则悬疑', text: `${overlapParagraph}\n\n他把另一张证翻了过来。`, recent: [`昨夜下了雨。\n\n${overlapParagraph}`], signals: ['recent_prose_overlap'] },
  { id: 'repeated-ending', genre: '都市', text: `维修员关了总闸。\n\n${ending}`, recent: [`病人走出医院。\n\n${ending}`, `院里的狗不叫了。\n\n${ending}`], signals: ['repeated_ending'] },
  { id: 'transition-cluster', genre: '玄幻', text: '下一刻，门闩脱开，碎木砸在院中的石阶上。\n\n下一刻，守门人退了半步，手指按住刀柄。\n\n下一刻，门外的人掀开雨披，露出一封湿信。', signals: ['clustered_transitions'] },
  { id: 'explanation-cluster', genre: '规则悬疑', text: '这意味着他失去了出城资格，必须重新登记。\n\n这意味着桌上的票据失效，谁也不能替他担保。\n\n这意味着他必须赶在关门前找到那个经办人。', signals: ['clustered_explanations'] },
  { id: 'assistant-leak', genre: '都市', text: '以下是生成的正文：\n\n陈昕推开诊室门，号牌还攥在手里。', signals: ['assistant_preamble'] },
  { id: 'quiet-payoff', genre: '生活', text: '父亲把最后一只碗放进橱柜。\n\n“明早几时走？”\n\n“五点。”\n\n父亲点了点头，去阳台收她那件没干透的外套。她隔着玻璃看了一会儿，起身把闹钟改成四点半。', signals: [] },
  { id: 'causal-explanation', genre: '规则悬疑', text: '枪响以后，顾平安的衣服没有破。开枪的人却跌了下去，胸口洇出一团血。\n\n这意味着权证管的不是武器，而是这次死亡该由谁负责。\n\n他放下凳腿，先去捡那人丢在地上的黑纸。', signals: [] },
  { id: 'character-catchphrase', genre: '日常', text: '“下一刻的事，下一刻再说。我今天只管把你的车修好，钱若是不够，就先把车推回去，下个月领了工钱再来。”\n\n老周擦了擦扳手。\n\n“下一刻的事，下一刻再说。我今天只管把你的车修好，钱若是不够，就先把车推回去，下个月领了工钱再来。”', signals: [] },
  { id: 'single-transition', genre: '玄幻', text: '少年把水桶提上台阶。\n\n然而门没有开，里面的人只递出一张写着药名的纸。', signals: [] },
  { id: 'dialogue-contrast', genre: '职场', text: '“我不是来求你签字，是来拿走我的底稿。”\n\n她拆下文件夹上的夹子，抽走有自己笔迹的那几页。经理伸手去拦，桌边的录音笔亮了一下。', signals: [] },
  { id: 'fictional-ai-character', genre: '科幻', text: '“我是人工智能，不懂你说的疼。”\n\n林医生把它的手接到自己的腕上。\n\n“那先学会量脉搏。”', signals: [] },
  { id: 'one-ending-echo', genre: '悬疑', text: `墙后的脚步停了。\n\n${ending}`, recent: [`客人放下杯子。\n\n${ending}`], signals: [] },
  { id: 'short-image-echo', genre: '情感', text: '窗上的雨停了。\n\n母亲把伞留在门边。\n\n窗上的雨停了。', signals: [] },
  { id: 'no-lexical-ban', genre: '历史', text: '他蓦地站住。墙后的箭没有射向队伍，反倒钉进了粮车的木轴。\n\n“不是劫粮。”他把车夫拽下来，“他们要把路堵死。”', signals: [] },
  { id: 'intentional-recap-signal-only', genre: '悬疑', text: `他记起案卷上的原话：\n\n${overlapParagraph}`, recent: [overlapParagraph], signals: ['recent_prose_overlap'] },
  { id: 'table-code-not-prose', genre: '游戏', text: '```text\n下一刻，门闩脱开，碎木砸在院中的石阶上。\n下一刻，守门人退了半步，手指按住刀柄。\n下一刻，门外的人掀开雨披，露出一封湿信。\n```\n\n他合上日志，去找那扇门。', signals: [] },
  { id: 'human-dialogue-unevenness', genre: '都市', text: '“钱呢？”\n\n“在——”他摸了两只口袋，把手留在第二只里。\n\n收银员没催，拿走了台面上的塑料袋。\n\n“那牛奶先不买了。”', signals: [] }
];
