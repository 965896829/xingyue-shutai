import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const docs = fs.readdirSync('docs').filter(f => f.endsWith('.md'));
const broken=[];
for (const name of docs) {
  const file=path.join('docs',name),content=fs.readFileSync(file,'utf8');
  for (const match of content.matchAll(/\]\(([^)\n]+)\)/g)) {
    const link=match[1].replace(/^<|>$/g,'').split('#')[0];
    if (!link || /^(https?:|app:|codex:|mailto:)/i.test(link)) continue;
    const target=decodeURIComponent(link).replace(/:\d+$/, '');
    if (!fs.existsSync(path.isAbsolute(target)?target:path.resolve('docs',target)))broken.push({file,link});
  }
}
assert.deepEqual(broken,[],'Broken documentation links');
const ids=file=>[...fs.readFileSync(file,'utf8').matchAll(/^\| (REQ-[A-Z]\d+) \|/gm)].map(m=>m[1]);
assert.deepEqual(ids('docs/15_逐项实施与验收状态.md'),ids('docs/04_功能追溯矩阵.md'));
assert.equal(ids('docs/15_逐项实施与验收状态.md').length,180);
const source=String.raw`D:\aiwangwen2\webnovel-seed-to-chapter`;
const skillFiles=fs.readdirSync('resources/skill',{recursive:true}).filter(f=>fs.statSync(path.join('resources/skill',f)).isFile());
assert.equal(skillFiles.length,9);
for(const file of skillFiles) assert.equal(sha(path.join('resources/skill',file)),sha(path.join(source,file)));
const tests=fs.readFileSync('.test-output/tests.tap','utf8');
// Node chooses TAP or the spec reporter depending on its output stream.
const total=Number(tests.match(/(?:#|ℹ) tests (\d+)\r?\n/)?.[1]);
assert.ok(total>=37); assert.equal(Number(tests.match(/(?:#|ℹ) pass (\d+)\r?\n/)?.[1]),total); assert.match(tests,/(?:#|ℹ) fail 0\r?\n/);
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const installer=`release/文序 Setup ${version}.exe`;
const report={at:new Date().toISOString(),docs:docs.length,brokenLinks:broken,requirementIds:180,skillFilesByteExact:9,tests:total,failures:0,installer:{path:installer,bytes:fs.statSync(installer).size,sha256:sha(installer)},buildInputs:{lockfile:sha('package-lock.json'),main:sha('dist-electron/main.cjs'),worker:sha('dist-electron/worker.cjs')},note:'文档和构建完整性检查，不能替代未完成的真实端点、文学效果与操作系统矩阵验收'};
fs.writeFileSync('.test-output/delivery-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
