import fs from 'node:fs';
import path from 'node:path';
import { hash } from './domain';
import { safePath } from './storage';
import { titleStyleProfileSchema, type TitleStyleProfile } from '../shared/title-style';

const relative = 'registry/title-style-profile.json';

/** Local, locked evidence profile. Loading it never makes a network request. */
export function loadTitleStyleProfile(skillRoot: string): TitleStyleProfile {
  const root = path.join(skillRoot, 'tags');
  const lock: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, 'resources.lock.json'), 'utf8'));
  const raw = fs.readFileSync(safePath(root, relative));
  if (lock[relative] !== hash(raw)) throw new Error('书名风格资料完整性检查失败，请更新完整资源包');
  if (raw.includes(0) || raw.length > 32_000) throw new Error('书名风格资料格式无效或超过32 KB');
  return titleStyleProfileSchema.parse(JSON.parse(raw.toString('utf8')));
}
