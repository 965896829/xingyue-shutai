import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
const parent = path.resolve('.test-output/ui-books');
fs.mkdirSync(parent, { recursive: true });
const service = new Service(path.resolve('resources/skill'), () => {});
const root = path.join(parent, '《桌面验收作品》创作档案');
if (!fs.existsSync(root))
  await service.invoke('project.create', {
    parent,
    title: '桌面验收作品',
    premise: '阿宁在旧城追查遗失的药方。左手的伤尚未治好，三日后必须抵达山门。'
  });
service.close();
const settingsFile = path.resolve('.test-output/electron-userdata/settings.json');
const settings = fs.existsSync(settingsFile)
  ? JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  : { profiles: [] };
settings.recent = [{ title: '桌面验收作品', root }];
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
console.log({ root });
