import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { refactorFixture } from './fixtures/refactor';

test('committed same-size replacement invalidates cached hashes even when timestamps coincide', (t) => {
  const { root, store } = refactorFixture();
  try {
    const relative = '缓存.md', file = path.join(root, relative);
    store.commit([{ path: relative, content: '旧稿', baseHash: null }], store.db.project());
    const before = store.inspect(relative)!;
    const stat = fs.statSync(file, { bigint: true });
    const originalStat = fs.statSync;
    // Some filesystems expose identical timestamps for successive short writes.
    t.mock.method(fs, 'statSync', (...args: Parameters<typeof fs.statSync>) =>
      args[0] === file ? stat : originalStat(...args));
    store.commit([{ path: relative, content: '新稿', baseHash: before.hash }], store.db.project());
    assert.equal(store.read(relative).content, '新稿');
    assert.equal(store.inspect(relative)?.status, 'accepted');
    assert.equal(store.scan().find(document => document.path === relative)?.status, 'accepted');
  } finally {
    t.mock.restoreAll();
    store.close();
  }
});
