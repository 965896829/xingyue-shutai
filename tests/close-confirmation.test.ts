import test from 'node:test';
import assert from 'node:assert/strict';
import { CloseConfirmation } from '../electron/close-confirmation';

test('repeated native/menu close requests share one dialog and never imply approval', () => {
  const close = new CloseConfirmation();
  const first = close.request();
  assert.ok(first);
  assert.equal(close.request(), first);
  assert.equal(close.approved, false);
});

test('cancel invalidates the request; its delayed approval cannot quit a new dialog', () => {
  const close = new CloseConfirmation();
  const first = close.request()!;
  assert.equal(close.respond(first, 'cancel'), true);
  assert.equal(close.pending, null);
  assert.equal(close.approved, false);
  const next = close.request()!;
  assert.notEqual(next, first);
  assert.equal(close.respond(first, 'quit'), false);
  assert.equal(close.pending, next);
  assert.equal(close.approved, false);
});

test('exit requires the current request and duplicate confirmations do not quit twice', () => {
  const close = new CloseConfirmation();
  assert.equal(close.respond('not-requested', 'quit'), false);
  const id = close.request()!;
  assert.equal(close.respond(id, 'quit'), true);
  assert.equal(close.approved, true);
  assert.equal(close.respond(id, 'quit'), false);
  assert.equal(close.request(), null);
});
