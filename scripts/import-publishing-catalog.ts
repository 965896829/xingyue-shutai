import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { hash } from '../src/core/domain';
import { fingerprint } from '../src/core/runtime/canonical';
import { verifyPublishingSnapshot } from '../src/core/publishing';

const source = path.resolve('xingyue-agent-design/data/fanqie');
const target = path.resolve('resources/skill/platform');
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(source, file), 'utf8'));
const taxonomy = read('taxonomy-2026-10-29.json');
const crosswalk = read('male-reading-crosswalk-2026-10-29.json');
const library = taxonomy.surfaces.filter((s: any) => s.surface === 'public_library_reading_catalog');
const ranking = taxonomy.surfaces.find((s: any) => s.options.some((o: any) => o.newBookRankUrl));
const data = {
  observedAt: library.map((s: any) => s.observedAt).sort().at(-1),
  extractorVersion: 1,
  sources: library.map((s: any) => ({ channel: s.channel, url: s.sourceUrl, observedAt: s.observedAt, hash: s.sourceSha256 })),
  options: library.flatMap((s: any) => s.options.map((o: any) => {
    const legacy = crosswalk.mappings.find((m: any) => m.sourceOptionKey === o.optionKey);
    return { id: o.optionKey, platformId: o.platformId, channel: s.channel, group: o.group, label: o.label,
      ...(legacy ? { legacyId: legacy.localOptionId, conceptId: legacy.localConceptId } : {}) };
  })),
  ranks: ranking.options.map((o: any) => ({ id: o.optionKey, channel: o.audience, platformId: o.platformId, label: o.label, url: o.readingRankUrl })),
  ranksObservedAt: ranking.observedAt,
  source: 'bundled'
};
const catalog = verifyPublishingSnapshot({ id: fingerprint(data), ...data });
const text = JSON.stringify(catalog, null, 2) + '\n';
const lock = { 'fanqie.json': hash(text) };
if (process.argv.includes('--check')) {
  assert.equal(fingerprint(JSON.parse(fs.readFileSync(path.join(target, 'fanqie.json'), 'utf8'))), fingerprint(catalog));
  const current = fs.readFileSync(path.join(target, 'fanqie.json'), 'utf8');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'resources.lock.json'), 'utf8'))['fanqie.json'], hash(current));
} else {
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'fanqie.json'), text);
  fs.writeFileSync(path.join(target, 'resources.lock.json'), JSON.stringify(lock, null, 2) + '\n');
}
console.log(JSON.stringify({ id: catalog.id, options: catalog.options.length, ranks: catalog.ranks.length, legacyMappings: catalog.options.filter(o => o.legacyId).length }));
