import { z } from 'zod';
import fs from 'node:fs';
import { professionalMethod } from './creation-policy';
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

function defaults(root: string): Record<RoleId, { title: string; summary: string; text: string }> {
  const legacy = JSON.parse(fs.readFileSync(path.join(root, 'design-v7/history/editor-defaults.json'), 'utf8'));
  return { ...legacy, coeditor: { title: '番茄创作共编', summary: '结合当前作品讨论、比较和处理已授权的修改。',
    text: professionalMethod(root, 'co-editor').content } };
}
const retiredDefaultHashes: Partial<Record<RoleId, string[]>> = {
  editor: ['5189f90547ed6dc3'],
  qidian: ['fda6f74c53aeece7']
};
export function builtInRoles(root = path.resolve('resources/skill')): RoleRule[] {
  return (['coeditor'] as const).map((key) => {
    const def = defaults(root)[key],
      current = {
        id: `default-${hash(def.text).slice(0, 16)}`,
        text: def.text,
        at: '2026-11-03',
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
  constructor(directory: string, private readonly skillRoot = path.resolve('resources/skill')) {
    this.file = path.join(directory, 'assistant-settings.json');
    const schema = z.object({
      roles: z.record(z.string(), z.object({ current: z.string(), history: z.array(z.object({ id: z.string(), text: z.string(), at: z.string(), reason: z.string(), source: z.object({ id: z.string(), version: z.string() }).optional() })) })).default({}),
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
    return roleIds.filter(key => key === 'coeditor' || !!this.data.roles[key]).map((key) => {
      const def = defaults(this.skillRoot)[key],
        saved = this.data.roles[key];
      const original = {
        id: `default-${hash(def.text).slice(0, 16)}`,
        text: def.text,
        at: key === 'coeditor' ? '2026-11-03' : '2026-10-30',
        reason: '内置默认'
      };
      const history = saved?.history ?? [];
      const selected = history.find((v) => v.id === saved?.current);
      const inheritedDefault = selected?.reason === '恢复默认' &&
        (key === 'coeditor' || retiredDefaultHashes[key]?.includes(hash(selected.text).slice(0, 16)));
      return {
        id: key,
        archived: key !== 'coeditor',
        title: def.title,
        summary: def.summary,
        defaultText: def.text,
        current: inheritedDefault ? original : selected ?? original,
        history: [original, ...history]
      };
    });
  }
  saveRole(key: RoleId, text: string, reason = '作者编辑', source?: { id: string; version: string }) {
    if (!roleIds.includes(key) || !text.trim() || text.length > 30000)
      throw new Error('角色规则应为 1—30000 字符');
    if (source) {
      const archived = this.roles().find(role => role.id === source.id && role.archived);
      if (key !== 'coeditor' || !archived?.history.some(version => version.id === source.version))
        throw new Error('旧编辑偏好来源不存在，请重新选择');
      if (reason === '作者编辑') reason = `迁入旧编辑偏好：${archived.title}`;
    }
    const version = { id: id(), text, at: now(), reason, ...(source ? { source } : {}) };
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
    return this.saveRole(key, old.text, `回退至 ${old.at}`, old.source);
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
