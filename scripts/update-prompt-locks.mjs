import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve('resources/skill');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (entry.isSymbolicLink()) throw new Error(`Linked prompt resource: ${entry.name}`);
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? files(file) : [file];
});
const registryFile = path.join(root, 'runtime/skills.registry.json');
const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
for (const entry of registry.skills) entry.sha256 = digest(path.join(root, 'runtime', entry.path));
write(registryFile, registry);
for (const name of ['runtime', 'design-v7', 'creative-v7', 'tags', 'direction-planning', 'title-market-editing']) {
  const directory = path.join(root, name);
  const lock = Object.fromEntries(files(directory)
    .filter(file => file !== path.join(directory, 'resources.lock.json'))
    .map(file => [path.relative(directory, file).replaceAll('\\', '/'), digest(file)])
    .sort(([a], [b]) => a.localeCompare(b, 'en')));
  write(path.join(directory, 'resources.lock.json'), lock);
}
console.log('Updated prompt resource locks and skill registry.');
