import type { ContextManifest, ProjectState } from '../shared/types';
import { prosePath } from './domain';
import { pendingSource } from './memory-source';
import type { FileStore } from './storage';
import { editorialReviewInput, inspectProse, type EditorialReport, type ProseSource } from './prose-editorial';

/** Local comparisons do not expand a character's knowledge or use drafts. */
export function chapterEditorial(store: FileStore, project: ProjectState, manifest: ContextManifest, prose: ProseSource): EditorialReport {
  const recent: ProseSource[] = [];
  if (manifest.scope?.viewpoint === 'author') {
    for (let chapter = Math.max(1, project.chapter - project.config.recentChapters); chapter < project.chapter; chapter++) {
      const file = prosePath(chapter);
      if (project.chapters[chapter] !== 'complete' || pendingSource(project, file) || store.inspect(file)?.status !== 'accepted') continue;
      recent.push(store.readAccepted(file, manifest.snapshotId));
    }
  }
  return inspectProse(prose, recent);
}

/** Optional evidence must never evict the manuscript, author rules or plan. */
export function attachEditorial<T extends object>(input: T, report: EditorialReport, fits: (input: object) => boolean) {
  const findings = [...report.findings];
  while (findings.length) {
    const editorial = editorialReviewInput({ ...report, findings });
    const value = { ...input, editorial };
    if (JSON.stringify(editorial).length <= 3600 && fits(value)) {
      const references: NonNullable<ContextManifest['referenceSources']> = [...new Map(findings.flatMap(finding => finding.evidence)
        .filter(evidence => report.compared.some(source => source.path === evidence.path && source.hash === evidence.hash))
        .map(evidence => [evidence.path, { path: evidence.path, hash: evidence.hash, reason: 'editorial-comparison' as const }])).values()];
      return { input: value, references, included: findings.length, omitted: report.findings.length - findings.length };
    }
    findings.pop();
  }
  return { input, references: [], included: 0, omitted: report.findings.length };
}
