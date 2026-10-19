import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../../src/core/service';
const base = path.resolve('.test-output/refactor');
const profile = path.join(base, 'electron 用户 空格');
const parent = path.join(base, 'smoke 项目');
fs.mkdirSync(parent, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
const service = new Service(path.resolve('resources/skill'), () => {});
try {
  const snapshot = await service.invoke('project.create', { parent, title: '隔离验收作品', premise: '完全合成的本地验收数据' });
  const recent = [{ title: snapshot.project!.title, root: snapshot.project!.root }];
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ profiles: [], recent }));
  fs.writeFileSync(path.join(base, 'smoke-project.json'), JSON.stringify(recent[0]));
  console.log(JSON.stringify(recent[0]));
} finally { service.close(); }
