import { isLedger, ledgerMaterial } from '../ledger-material';
import type { ContextManifest, Run, ProjectState } from '../../shared/types';
import { stageOutputs } from '../domain';
import { FileStore, fileHash, safePath } from '../storage';

/** Reading a known output scaffold is a local operation, not a model decision.
 * Keep the original hash in the manifest so every request still detects edits.
 * Large optional targets may be omitted by fitContext and read on demand. */
export function preloadOutputTargets(store: FileStore, run: Run, project: ProjectState, manifest: ContextManifest) {
  if (run.mode !== 'stage') return;
  const targets = stageOutputs(run.pipeline?.phase === 'memory' ? 'S11' : run.stage, project);
  for (const file of targets) {
    if (run.changes.some(change => change.path === file) || run.documentDrafts?.some(draft => draft.path === file)) continue;
    const prior = manifest.sources.find(source => source.path === file);
    const memory = isLedger(file) && (run.pipeline?.phase === 'memory' || run.stage === 'S11');
    if (prior?.mode === 'full' && !memory) continue;
    const doc = store.db.document(file);
    const disk = fileHash(safePath(store.root, file));
    if (!doc && disk === null) continue;
    if (!doc?.hash || doc.hash !== disk || store.inspect(file)?.status !== 'accepted')
      throw new Error(`目标文件有未确认的外部变化：${file}`);
    const source = store.readAccepted(file, manifest.snapshotId);
    if (memory) {
      const facts = [...manifest.retrievedFacts ?? [], ...manifest.hardConstraints ?? []];
      const slice = ledgerMaterial(source.content, run.chapter, facts.map(f => f.subject),
        facts.flatMap(f => f.evidence.filter(e => e.path === file).map(e => e.quote)));
      manifest.sources = manifest.sources.filter(item => item.path !== file);
      manifest.sources.push({ path: file, hash: source.hash, content: slice.content, ranges: slice.ranges,
        mode: 'excerpt', required: true, reason: '按 sourceHash 提交台账 patch；未变行由宿主保留',
        layer: 'summary', category: 'derived_summary', sourceSnapshotId: manifest.snapshotId });
      continue;
    }
    manifest.sources = manifest.sources.filter(item => item.path !== file);
    manifest.sources.push({ path: file, hash: source.hash, content: source.content,
      ranges: [{ start: 0, end: Array.from(source.content).length }], mode: 'full', required: prior?.required ?? false,
      reason: '本阶段目标的完整基础版本；直接使用此 hash 作为 baseHash，无需重复读取',
      layer: file.startsWith('04_') || file.startsWith('08_') ? 'summary' : 'chapter_plan',
      category: file.startsWith('04_') || file.startsWith('08_') ? 'derived_summary' : 'plan',
      sourceSnapshotId: manifest.snapshotId });
  }
}
