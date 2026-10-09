import test from 'node:test';
import assert from 'node:assert/strict';
import registry from '../src/shared/official-model-limits.json';
import { profileSchema } from '../src/shared/types';
import {
  officialModelLimits,
  applyModelLimits,
  inputTokenBudget,
  requireModelLimits
} from '../src/shared/model-limits';
import { limitsFromCatalog, migrateModelLimits, trustedModelLimits } from '../src/core/model-limits';
import { prepareProviderGroup } from '../src/core/provider-groups';
import { connectionFields, modelFields } from '../src/shared/provider-groups';
import { requestBody } from '../src/core/provider';

const profile = (model = 'gpt-6.1-sol') =>
  profileSchema.parse({
    id: 'old-id',
    name: '供应商',
    protocol: 'responses',
    baseUrl: 'https://relay.test/v1',
    model,
    limitMode: 'official',
    version: 4,
    hasKey: true,
    capabilities: { tools: 'verified' }
  });

test('official registry uses exact verified IDs, distinct limits and recorded sources', () => {
  const seen = new Set<string>();
  for (const row of registry)
    for (const model of row.models) {
      assert.ok(!seen.has(model), model);
      seen.add(model);
      assert.ok(officialModelLimits(model, 'responses'));
    }
  assert.equal(officialModelLimits('gpt-6.1-sol', 'responses')!.contextLimit, 1050000);
  assert.equal(officialModelLimits('gpt-6.1-sol', 'responses')!.inputLimit, 922000);
  assert.equal(officialModelLimits('gpt-6.1-sol', 'responses')!.outputLimit, 128000);
  assert.equal(officialModelLimits('gpt-5.4-mini', 'responses')!.contextLimit, 400000);
  assert.equal(officialModelLimits('gpt-4.1', 'chat')!.outputLimit, 32768);
  assert.equal(officialModelLimits('gpt-5.6', 'responses')!.contextLimit, 1050000);
  assert.equal(officialModelLimits('gpt-6.1-sol-unknown', 'responses'), null);
  assert.equal(officialModelLimits('relay/gpt-6.1-sol', 'responses'), null);
  assert.equal(officialModelLimits('gpt-image-2', 'images'), null);
});

test('existing profiles migrate once, preserve credentials/IDs/manual overrides, invalidate changed versions', () => {
  const old = { ...profile(), encryptedKey: 'opaque', enabled: false };
  delete (old as any).limitMode;
  delete (old as any).modelLimits;
  delete (old as any).inputLimit;
  const manual = {
    ...profile(),
    id: 'manual',
    limitMode: 'manual' as const,
    contextLimit: 64000,
    outputLimit: 4096,
    encryptedKey: 'other'
  };
  const unknown = { ...old, id: 'unknown', model: 'private-model' };
  const first = migrateModelLimits([old, manual, unknown]);
  assert.equal(first[0].contextLimit, 1050000);
  assert.equal(first[0].outputLimit, 128000);
  assert.equal(first[0].encryptedKey, old.encryptedKey);
  assert.equal(first[0].enabled, false);
  assert.equal(first[0].id, old.id);
  assert.equal(first[0].version, 5);
  assert.deepEqual(first[0].capabilities, {});
  assert.equal(first[1].contextLimit, 64000);
  assert.equal(first[1].version, 4);
  assert.equal(first[2].limitMode, 'manual');
  assert.equal(first[2].modelLimits, null);
  assert.deepEqual(migrateModelLimits(first), first);
});

test('saving selected models applies each official limit at the backend, ignores renderer provenance', () => {
  const a = { ...profile(), encryptedKey: 'opaque' };
  const b = profile('gpt-5.4-mini');
  const result = prepareProviderGroup([a], connectionFields(a), [modelFields(a), modelFields(b)]);
  assert.equal(result.saved[0].id, a.id);
  assert.equal(result.saved[0].contextLimit, 1050000);
  assert.equal(result.saved[1].contextLimit, 400000);
  assert.equal(result.saved[1].outputLimit, 128000);
  const evil = {
    ...modelFields(profile('unknown')),
    modelLimits: { ...result.saved[0].modelLimits, model: 'unknown' }
  };
  assert.throws(() => prepareProviderGroup([a], connectionFields(a), [evil]), /尚未核实/);
});

test('unknown automatic models are blocked, manual configuration and images remain usable', () => {
  const p = applyModelLimits(profile('unlisted'), null);
  assert.throws(() => requireModelLimits(p), /尚未核实/);
  assert.doesNotThrow(() => requireModelLimits({ ...p, limitMode: 'manual' }));
  assert.doesNotThrow(() => requireModelLimits({ ...p, protocol: 'images' }));
  const known = applyModelLimits(profile(), officialModelLimits('gpt-6.1-sol', 'responses'));
  const manual = { ...known, limitMode: 'manual' as const, outputLimit: 16000 };
  assert.equal(applyModelLimits(manual, known.modelLimits).outputLimit, 16000);
});

test('official API metadata supports Gemini separate limits, Claude shared limits and DeepSeek fields', () => {
  const google = { protocol: 'gemini' as const, baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };
  const gemini = limitsFromCatalog(google, 'gemini-new', {
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536
  })!;
  assert.equal(gemini.origin, 'official-api');
  assert.equal(gemini.windowKind, 'separate');
  assert.equal(gemini.contextLimit, 1114112);
  const p = applyModelLimits({ ...profile('gemini-new'), ...google }, gemini);
  assert.equal(inputTokenBudget(p), 1048576);
  const claude = limitsFromCatalog(
    { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
    'claude-new',
    { max_input_tokens: 1000000, max_tokens: 128000 }
  )!;
  assert.equal(claude.contextLimit, 1000000);
  assert.equal(claude.outputLimit, 128000);
  const ds = limitsFromCatalog({ protocol: 'chat', baseUrl: 'https://api.deepseek.com' }, 'deepseek-flash', {
    context_window: 1048576,
    max_output_tokens: 393216
  })!;
  assert.equal(ds.outputLimit, 393216);
});

test('relay metadata cannot impersonate official provenance and invalid limits are ignored', () => {
  for (const baseUrl of [
    'https://api.anthropic.com.evil.test/v1',
    'https://relay.test/v1',
    'http://api.anthropic.com/v1'
  ]) {
    assert.equal(
      limitsFromCatalog({ protocol: 'anthropic', baseUrl }, 'claude-unknown', {
        max_input_tokens: 1000000,
        max_tokens: 128000
      }),
      null
    );
  }
  const c = { protocol: 'gemini' as const, baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };
  assert.equal(
    limitsFromCatalog(c, 'gemini-new', { inputTokenLimit: '1000000', outputTokenLimit: 65000 }),
    null
  );
  assert.equal(
    limitsFromCatalog(c, 'gemini-new', { inputTokenLimit: Infinity, outputTokenLimit: 65000 }),
    null
  );
  const valid = limitsFromCatalog(c, 'gemini-new', { inputTokenLimit: 1048576, outputTokenLimit: 65536 })!;
  assert.equal(trustedModelLimits({ ...profile('gemini-new'), modelLimits: valid }), null);
});

test('request payload carries official output cap and input budget respects both independent and total limits', () => {
  const p = applyModelLimits(profile(), officialModelLimits('gpt-6.1-sol', 'responses'));
  assert.equal(requestBody({ ...p, apiKey: '' }, 'test', [], []).body.max_output_tokens, 128000);
  assert.equal(inputTokenBudget(p), 922000);
  assert.equal(inputTokenBudget({ ...p, inputLimit: 100000 }), 100000);
  assert.equal(inputTokenBudget({ ...p, inputLimit: null }), 922000);
  assert.equal(inputTokenBudget({ ...p, contextLimit: 200000, outputLimit: 128000 }), 72000);
});

test('updating only official API provenance does not invalidate a task version', () => {
  const c = { protocol: 'gemini' as const, baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };
  const spec = limitsFromCatalog(c, 'gemini-new', { inputTokenLimit: 1048576, outputTokenLimit: 65536 })!;
  const p = { ...applyModelLimits({ ...profile('gemini-new'), ...c }, spec), encryptedKey: 'opaque' };
  const newer = { ...spec, checkedAt: '2026-10-09' };
  const saved = prepareProviderGroup([p], connectionFields(p), [modelFields(p)], undefined, () => newer).saved[0];
  assert.equal(saved.modelLimits!.checkedAt, newer.checkedAt);
  assert.equal(saved.version, p.version);
  assert.deepEqual(saved.capabilities, p.capabilities);
});
