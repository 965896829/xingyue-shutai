import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as asar from '@electron/asar';

const archive = path.resolve('release/win-unpacked/resources/app.asar');
const destination = path.resolve('.test-output/refactor/baseline-source');
const baseline = new Map(JSON.parse(fs.readFileSync('.test-output/refactor/baseline/files.json', 'utf8')).map((file) => [path.resolve(file.Path).toLowerCase(), file.Hash.toLowerCase()]));
const files = new Map();
for (const entry of asar.listPackage(archive).filter((file) => file.endsWith('.map'))) {
  const sourceMap = JSON.parse(asar.extractFile(archive, entry.replace(/^[/\\]/, '')).toString('utf8'));
  for (let index = 0; index < sourceMap.sources.length; index++) {
    const source = sourceMap.sources[index].replaceAll('\\', '/');
    const match = source.match(/(?:^|\/)(src\/.*|electron\/.*)$/);
    if (!match || source.includes('node_modules') || !sourceMap.sourcesContent?.[index]) continue;
    const relative = match[1];
    const content = sourceMap.sourcesContent[index];
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    const expected = baseline.get(path.resolve(relative).toLowerCase());
    if (!expected) continue;
    files.set(relative, { relative, digest, expected, matched: expected === digest });
    if (expected === digest) {
      const target = path.resolve(destination, relative);
      if (!target.startsWith(destination + path.sep)) throw new Error('Baseline path escaped');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
}
fs.writeFileSync('docs/refactor/performance/baseline-source.json', JSON.stringify({ archive, files: [...files.values()] }, null, 2));
console.log(JSON.stringify({ found: files.size, matched: [...files.values()].filter((file) => file.matched).length, storage: files.get('src/core/storage.ts'), service: files.get('src/core/service.ts'), app: files.get('src/ui/App.tsx') }, null, 2));
