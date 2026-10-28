import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NarrativeComparison } from '../../src/ui/NarrativeComparison';
import type { Snapshot } from '../../src/shared/types';
import type { NarrativeData } from '../../src/shared/narrative-curve';

const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
export async function verifyDimensionComparison(snapshot: Snapshot) {
  const host = document.createElement('div'); host.className = 'narrative-content'; document.body.append(host);
  const root = createRoot(host), selected: unknown[] = [];
  const source = (quote: string) => ({ path: 'isolated.md', hash: 'a'.repeat(64), quote });
  const data: NarrativeData = { chapter: 1, range: [1, 30], unavailable: 0, chapters: [{ chapter: 1, plan: null, actual: null,
    planValues: { pressure: 2, emotion: 1 }, actualValues: { pressure: 3 }, candidateValues: { pressure: 4 },
    planSource: source('计划'), actualSource: source('正文'), candidateSource: source('草稿') }] };
  try {
    flushSync(() => root.render(<NarrativeComparison snapshot={{ ...snapshot, studio: { ...snapshot.studio!, assessments: [] } }} data={data} onSource={value => selected.push(value)} />));
    await new Promise(resolve => requestAnimationFrame(resolve));
    check(host.querySelectorAll('.curve-hit').length === 3, 'Three tracks must be visible without calling a model');
    check(host.querySelector('[data-series="candidate"] .curve-path')?.classList.contains('dashed'), 'Draft must be dashed');
    check(!host.querySelector('[data-series="accepted"] .curve-path')?.classList.contains('dashed'), 'Accepted must be solid');
    host.querySelector('.curve-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check(selected.length === 1, 'Point must open exact source');
    const select = host.querySelector('select')!;
    flushSync(() => { select.value = 'emotion'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    check(host.querySelectorAll('.curve-hit').length === 1, 'Missing dimensions must not be invented');
    check(host.querySelector('.curve-path')?.getAttribute('d')?.startsWith('M '), 'Curve has valid path');
    return { threeTracks: true, draftDashed: true, acceptedSolid: true, exactSource: true, unknownDimensionsBlank: true };
  } finally { root.unmount(); host.remove(); }
}
