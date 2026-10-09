import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { previewLegacy, importLegacy } from '../src/core/migration';
import { hash } from '../src/core/domain';
const source=String.raw`D:\aiwangwen2\《卡在判定边界的我，被天道判成了既死又活》创作档案`;
const preview=previewLegacy(source),before=preview.files.map(f=>({path:f.path,hash:hash(fs.readFileSync(path.join(source,f.path)))}));
const parent=fs.mkdtempSync(path.join(os.tmpdir(),'wenxu-real-legacy-'));
const target=importLegacy({source,parent,title:'旧档案验证副本',chapter:4,stage:'S09',config:{}});
for(const f of before){assert.equal(hash(fs.readFileSync(path.join(source,f.path))),f.hash);assert.equal(hash(fs.readFileSync(path.join(target,f.path))),f.hash);}
fs.mkdirSync('.test-output',{recursive:true});fs.writeFileSync('.test-output/legacy-report.json',JSON.stringify({files:before.length,sourceUnchanged:true,copyByteExact:true,continuedAt:{chapter:4,stage:'S09'},sourceRecordsPendingReview:true,at:new Date().toISOString()},null,2));console.log({files:before.length,sourceUnchanged:true,copyByteExact:true});
