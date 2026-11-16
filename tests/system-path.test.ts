import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveSystemPath } from '../src/core/system-path';
import { ProjectRecycleBin, samePath } from '../src/core/recycle-bin';

test('macOS resolves only verified standard /var and /tmp root aliases', () => {
  assert.equal(resolveSystemPath('/var/folders/中文/作品', 'darwin', () => 'private/var'), '/private/var/folders/中文/作品');
  assert.equal(resolveSystemPath('/tmp/作品', 'darwin', () => '/private/tmp'), '/private/tmp/作品');
  assert.equal(resolveSystemPath('/var/作品', 'darwin', () => '/somewhere-else'), '/var/作品');
  assert.equal(resolveSystemPath('/var/作品', 'darwin', () => { throw new Error('unavailable'); }), '/var/作品');
  assert.equal(resolveSystemPath('/var-other/作品', 'darwin', () => { throw new Error('must not inspect'); }), '/var-other/作品');
  assert.equal(resolveSystemPath('/Users/author/shortcut/book', 'darwin', () => '/private/var'), '/Users/author/shortcut/book');
});

test('other systems retain ordinary path resolution without inspecting aliases', () => {
  assert.equal(resolveSystemPath('作品', 'win32', () => { throw new Error('must not inspect'); }), path.resolve('作品'));
});

test('macOS aliases identify one directory and do not allow nested symlinks into trash', { skip: process.platform !== 'darwin' }, () => {
  const temp = fs.realpathSync(os.tmpdir());
  const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-mac-links-'));
  try {
    assert.ok(samePath(scope, fs.realpathSync(scope)));
    const book = path.join(scope, '保留作品');
    fs.mkdirSync(book);
    fs.writeFileSync(path.join(book, '保留.txt'), '不能移动');
    const link = path.join(scope, '作者链接');
    fs.symlinkSync(book, link, 'dir');
    const bin = new ProjectRecycleBin(path.join(scope, 'userdata'));
    assert.throws(() => bin.trash(link, '不能回收'), /符号链接|目录联接/);
    assert.equal(fs.readFileSync(path.join(book, '保留.txt'), 'utf8'), '不能移动');
    assert.deepEqual(bin.list(), []);
  } finally {
    assert.equal(path.dirname(fs.realpathSync(scope)), temp);
    fs.rmSync(scope, { recursive: true, force: true });
  }
});
