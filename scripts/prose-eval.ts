import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { hash, prosePath } from '../src/core/domain';
import { inspectProse, editorialVersion } from '../src/core/prose-editorial';
import { proseQualityCases } from '../tests/fixtures/prose-quality';

/** Deterministic, offline signal regression. This deliberately has no model client. */
export function evaluateProse(destination = '.test-output/prose-eval') {
  const startedAt = new Date().toISOString(), start = performance.now();
  const cases = proseQualityCases.map(fixture => {
    const source = (text: string, file: string) => ({ path: file, hash: hash(text), content: text });
    const prose = source(fixture.text, prosePath(25)), recent = (fixture.recent ?? []).map((text, i) => source(text, prosePath(i + 1)));
    const before = performance.now(), result = inspectProse(prose, recent);
    const actual = [...new Set(result.findings.map(finding => finding.code))].sort(), expected = [...fixture.signals].sort();
    const evidenceValid = result.findings.every(finding => finding.evidence.every(evidence => {
      const doc = [prose, ...recent].find(doc => doc.path === evidence.path);
      return doc?.hash === evidence.hash && doc.content.slice(evidence.start, evidence.end) === evidence.quote;
    }));
    return { id: fixture.id, genre: fixture.genre, expected, actual, evidenceValid,
      passed: JSON.stringify(actual) === JSON.stringify(expected) && evidenceValid,
      elapsedMs: performance.now() - before, input: { prose, recent }, output: result };
  });
  const report = { version: editorialVersion, startedAt, completedAt: new Date().toISOString(), elapsedMs: performance.now() - start,
    suiteHash: hash(JSON.stringify(proseQualityCases)), cases, passed: cases.filter(row => row.passed).length,
    total: cases.length, complete: cases.every(row => row.passed), modelRequests: 0,
    actualCacheHitRate: null, literaryQualityVerified: false, commercialReadinessVerified: false,
    limitation: '原创合成样本，仅验证文本线索、误报边界和证据定位。不是模型生成复测、AI作者检测或文学质量盲评，不能据此宣称商业成稿合格。' };
  fs.mkdirSync(path.resolve(destination), { recursive: true });
  fs.writeFileSync(path.join(path.resolve(destination), 'report.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv.includes('--run-prose-eval')) {
  const output = process.argv.indexOf('--output');
  const report = evaluateProse(output < 0 ? undefined : process.argv[output + 1]);
  console.log(JSON.stringify({ complete: report.complete, passed: report.passed, total: report.total, elapsedMs: report.elapsedMs,
    modelRequests: report.modelRequests, literaryQualityVerified: report.literaryQualityVerified }));
  if (!report.complete) process.exitCode = 1;
}
