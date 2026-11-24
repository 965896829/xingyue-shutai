import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorMarkdown, mergeAuthorMarkdown } from '../src/shared/author-markdown';
import { FileStore } from '../src/core/storage';
import { newProject, paths, renderConfig } from '../src/core/domain';

test('作者编辑只改变可读段落，内部记录保留，普通代码示例保持可见', () => {
  for (const nl of ['\n', '\r\n']) {
    const block = ['## 客户端设置', '```json wenxu-config', '{"stageBudget":7}', '```', ''].join(nl);
    const example = ['## 作者备注', '```json', '{"线索":"雪"}', '```', ''].join(nl);
    const raw = '# 项目配置' + nl + block + example;
    const visible = authorMarkdown(raw);
    assert.equal(visible, '# 项目配置' + nl + example);
    const changed = visible.replace('雪', '雨');
    const result = mergeAuthorMarkdown(raw, changed);
    assert.equal(result, raw.replace('雪', '雨'));
    assert.equal(mergeAuthorMarkdown(raw, visible), raw);
    assert.doesNotMatch(authorMarkdown(block.slice(0, -6)), /stageBudget|客户端设置|wenxu-/);
  }
});

test('旧作品转换磁盘文稿后仍使用原有候选依据，外部改稿和中断恢复不丢失', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-readable-'));
  let store = new FileStore(root);
  try {
    const project = newProject('雪夜', root, {});
    const raw = renderConfig(project), file = path.join(root, paths.config);
    store.commit([{ path: paths.config, baseHash: null, content: raw }], project);
    const accepted = store.readAccepted(paths.config);
    const snapshot = store.db.head()!.id;
    assert.equal(fs.readFileSync(file, 'utf8'), authorMarkdown(raw));
    // Recreate the working file and mapping state left by a version-eight client.
    fs.writeFileSync(file, raw);
    store.db.sql.prepare("DELETE FROM kv WHERE key LIKE 'markdownView%'").run();
    store.db.sql.exec('PRAGMA user_version=8');
    store.close();
    store = new FileStore(root);
    store.recover();
    assert.equal(store.db.head()!.id, snapshot);
    assert.deepEqual(store.read(paths.config), accepted);
    assert.equal(store.inspect(paths.config)?.hash, accepted.hash);
    assert.equal(store.scan().find(d => d.path === paths.config)?.status, 'accepted');
    assert.equal(fs.readFileSync(file, 'utf8'), authorMarkdown(raw));
    const edited = fs.readFileSync(file, 'utf8') + '\n作者补充';
    fs.writeFileSync(file, edited);
    assert.equal(store.inspect(paths.config)?.status, 'external');
    assert.throws(() => store.commit([{ path: paths.config, baseHash: accepted.hash, content: raw }], project), /外部修改/);
    const version = store.workingHash(paths.config);
    const merged = mergeAuthorMarkdown(raw, edited);
    assert.throws(() => store.commit([{ path: paths.config, baseHash: version, content: merged }], project,
      undefined, point => { if (point === 'after-database') throw Error('模拟重启'); }), /模拟重启/);
    store.close();
    store = new FileStore(root);
    store.recover();
    assert.equal(store.inspect(paths.config)?.status, 'accepted');
    assert.equal(store.read(paths.config).content, merged);
    assert.match(store.read(paths.config, accepted.hash).content, /wenxu-config/);
    assert.match(fs.readFileSync(file, 'utf8'), /作者补充/);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /wenxu-config|targetWords/);
  } finally {
    store.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});
