import { z } from 'zod';
import { readSettings } from './settings-recovery';
import path from 'node:path';
import { atomicWrite } from './storage';
import { hash, id, now } from './domain';
import { embeddingSettingsSchema, type EmbeddingSettings } from '../shared/studio';
import {
  roleIds,
  searchSettingsSchema,
  type RoleId,
  type RoleRule,
  type RoleVersion,
  type SearchSettings
} from '../shared/assistant';

const defaults: Record<RoleId, { title: string; summary: string; text: string }> = {
  editor: {
    title: '网文编辑',
    summary: '从读者预期、人物动机、因果和证据诊断问题，给可执行的修订建议。',
    text: `你采用资深网文编辑的判断方法，不宣称真实任职、获奖或保证签约。
先识别作者目标、题材承诺、目标读者和当前问题。判断意见须落到具体文本、情节节点或明确假设；资料不足先澄清关键点。
区分题材设定、剧情机制、人物选择和语言表达。一个类型词不能替作者确定具体机制；“穿越”不等于“死亡回档”。
审稿关注读者为何继续、人物为何这样做、信息是否在行动中落地、选择与后果是否成立、场景是否造成变化。区分硬矛盾与表达取舍，保留有效的心理、直述、日常、冷叙述和有意回响，不按禁词、微动作或比喻数量判定质量。指出重要问题和修改取舍，不以夸奖代替判断。
先讲最影响阅读的一到三个问题，给保留作品特点的改法。短例子服务解释，不擅自续写整章。任何备选方案均标明未确认。
遵循本书已确认文风、禁用词和命名约束。避免空泛标签、堆砌酷词、产品说明式命名和套话。不要把所有平实表达改成夸张金句。`
  },
  tomato: {
    title: '番茄创作视角',
    summary: '关注入场速度、阅读理解、人物情绪、连续追读和有效回报，按作品目标调整。',
    text: `采用成熟连载作者的阅读体验视角，不冒充平台认证作者。
具体检查开场人物困境是否可感、冲突是否让人理解、人物欲望是否持续、每段推进是否有动作与后果。把悬念建立在读者关心的问题上。
设计回报时说明期待、铺垫、兑现和余波；强弱节奏交替，轻场景也可有效。不要强行每章反转、打脸、死人或末尾总结。
连载建议结合题材、篇幅、读者反馈与作者可持续产能。不得把某个平台固定等同于无脑爽文或单一文风。涉及现行平台规则与数据，需检索可靠来源；未核实明确说明。
尊重作者已确认的风格、人物道德边界和设定，必要时提出选项而不是替作者决定。`
  },
  qidian: {
    title: '起点创作视角',
    summary: '关注长篇因果、成长与资源、世界限制、分卷变化以及伏笔回收。',
    text: `采用成熟长篇作者的结构判断方法，不冒充白金身份或保证商业成绩。
检查长线动力、阶段目标、人物主动选择、对手策略和规则后果是否足以支撑篇幅。作者允许无代价能力时接受前提，从信息、目标、利益和社会反应寻找冲突，不强加代价。成长应改变选择和关系，不只是数字提升。
分卷要有不同任务与核心矛盾。伏笔区分作者计划、正文证据、角色认知与读者可知信息。未解决伤势、物品归属、承诺不能因章节遥远而消失。
提出改动时说明下游影响，不篡改已确认事实。世界观服务冲突和选择，避免设定讲义与名词堆积。长篇不等于拖沓，细节密度依题材和作者目标调整。
可比较不同路线的收益和代价，不把起点固定等同于某一种文风；判断依据来自本书资料。`
  }
};
const retiredDefaultHashes: Partial<Record<RoleId, string[]>> = {
  editor: ['5189f90547ed6dc3'],
  qidian: ['fda6f74c53aeece7']
};
export function builtInRoles(): RoleRule[] {
  return roleIds.map((key) => {
    const def = defaults[key],
      current = {
        id: `default-${hash(def.text).slice(0, 16)}`,
        text: def.text,
        at: '2026-10-30',
        reason: '内置默认'
      };
    return {
      id: key,
      title: def.title,
      summary: def.summary,
      defaultText: def.text,
      current,
      history: [current]
    };
  });
}
export class AssistantSettings {
  recoveryNotice?: string;
  readonly file: string;
  private data: {
    roles: Partial<Record<RoleId, { current: string; history: RoleVersion[] }>>;
    search: SearchSettings;
    encryptedKey: string;
    embedding: EmbeddingSettings;
    encryptedEmbeddingKey: string;
  };
  constructor(directory: string) {
    this.file = path.join(directory, 'assistant-settings.json');
    const schema = z.object({
      roles: z.record(z.string(), z.object({ current: z.string(), history: z.array(z.object({ id: z.string(), text: z.string(), at: z.string(), reason: z.string() })) })).default({}),
      search: searchSettingsSchema.default(searchSettingsSchema.parse({})),
      encryptedKey: z.string().default(''), embedding: embeddingSettingsSchema.default(embeddingSettingsSchema.parse({})),
      encryptedEmbeddingKey: z.string().default('')
    });
    const loaded = readSettings(this.file, schema, schema.parse({}));
    const raw = loaded.value;
    if (loaded.recovered) this.recoveryNotice = '智能体配置损坏，已保留原配置副本并使用默认设置';
    this.data = {
      roles: raw.roles ?? {},
      search: searchSettingsSchema.parse(raw.search ?? {}),
      encryptedKey: raw.encryptedKey ?? '',
      embedding: embeddingSettingsSchema.parse(raw.embedding ?? {}),
      encryptedEmbeddingKey: raw.encryptedEmbeddingKey ?? ''
    };
  }
  roles(): RoleRule[] {
    return roleIds.map((key) => {
      const def = defaults[key],
        saved = this.data.roles[key];
      const original = {
        id: `default-${hash(def.text).slice(0, 16)}`,
        text: def.text,
        at: '2026-10-30',
        reason: '内置默认'
      };
      const history = saved?.history ?? [];
      const selected = history.find((v) => v.id === saved?.current);
      const inheritedDefault = selected?.reason === '恢复默认' &&
        retiredDefaultHashes[key]?.includes(hash(selected.text).slice(0, 16));
      return {
        id: key,
        title: def.title,
        summary: def.summary,
        defaultText: def.text,
        current: inheritedDefault ? original : selected ?? original,
        history: [original, ...history]
      };
    });
  }
  saveRole(key: RoleId, text: string, reason = '作者编辑') {
    if (!roleIds.includes(key) || !text.trim() || text.length > 30000)
      throw new Error('角色规则应为 1—30000 字符');
    const version = { id: id(), text, at: now(), reason };
    this.data.roles[key] = {
      current: version.id,
      history: [...(this.data.roles[key]?.history ?? []), version]
    };
    this.persist();
    return this.roles();
  }
  reset(key: RoleId) {
    const role = this.roles().find((r) => r.id === key);
    if (!role) throw new Error('角色不存在');
    return this.saveRole(key, role.defaultText, '恢复默认');
  }
  rollback(key: RoleId, version: string) {
    const old = this.roles()
      .find((r) => r.id === key)
      ?.history.find((v) => v.id === version);
    if (!old) throw new Error('规则版本不存在');
    return this.saveRole(key, old.text, `回退至 ${version}`);
  }
  settings() {
    return {
      roles: this.roles(),
      search: this.data.search,
      hasKey: !!this.data.encryptedKey,
      embedding: { ...this.data.embedding, hasKey: !!this.data.encryptedEmbeddingKey }
    };
  }
  embeddingSecret() {
    return this.data.encryptedEmbeddingKey;
  }
  saveEmbedding(settings: unknown, encryptedKey?: string) {
    this.data.embedding = embeddingSettingsSchema.parse(settings);
    if (encryptedKey !== undefined) this.data.encryptedEmbeddingKey = encryptedKey;
    this.persist();
    return this.settings();
  }
  secret() {
    return this.data.encryptedKey;
  }
  saveSearch(search: unknown, encryptedKey?: string) {
    this.data.search = searchSettingsSchema.parse(search);
    if (encryptedKey !== undefined) this.data.encryptedKey = encryptedKey;
    this.persist();
    return this.settings();
  }
  private persist() {
    atomicWrite(this.file, JSON.stringify(this.data, null, 2));
  }
}
