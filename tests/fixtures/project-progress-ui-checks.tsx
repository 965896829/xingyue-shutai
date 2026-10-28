import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ProjectFiles } from '../../src/ui/ProjectFiles';
import type { DocumentInfo } from '../../src/shared/types';

/** Invoked through local Playwright; no project files or model requests. */
export async function verifyProjectProgressUI() {
  const host = document.createElement('aside');
  host.className = 'sidebar';
  host.style.cssText = 'position:fixed;left:0;top:0;width:260px;height:300px;z-index:99999;display:flex;flex-direction:column';
  document.body.append(host);
  const root = createRoot(host);
  const documents: DocumentInfo[] = Array.from({ length: 1200 }, (_, index) => ({ id: String(index),
    path: `07_正文章节/第${String(index + 1).padStart(3, '0')}章.md`, hash: null, acceptedHash: null, status: 'accepted', bytes: 0 }));
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const render = (rows: DocumentInfo[], current: string | undefined, selected = '', resetKey = 'project-a') =>
    flushSync(() => root.render(<StrictMode><ProjectFiles documents={rows} current={current} selected={selected} resetKey={resetKey} onOpen={() => {}} /></StrictMode>));
  const visible = () => {
    const row = host.querySelector<HTMLElement>('[aria-current="step"]'), list = host.querySelector<HTMLElement>('.files');
    if (!row || !list) return false;
    const a = row.getBoundingClientRect(), b = list.getBoundingClientRect();
    return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  };
  try {
    render(documents, documents[999].path, documents[1].path); await frame();
    check(visible(), 'Current chapter must be visible in a virtualized long book');
    check(host.querySelectorAll('button').length < 50, 'Keep the existing virtualized list bounded');
    check(host.querySelectorAll('[aria-current="step"]').length === 1, 'Exactly one current stage');
    const list = host.querySelector<HTMLElement>('.files')!;
    list.scrollTop = 0; list.dispatchEvent(new Event('scroll')); await frame();
    render(documents, documents[999].path, documents[2].path); await frame();
    check(list.scrollTop === 0, 'Viewing another file must not pull the author back to current progress');
    render(documents, documents[1000].path, documents[2].path); await frame();
    check(visible(), 'Chapter advancement must locate the new current chapter');
    host.style.height = '200px'; await frame(); await frame();
    check(visible(), 'Resizing the list must keep the current chapter visible');
    render([documents[2]], documents[1000].path, documents[2].path, 'project-a:filter'); await frame();
    check(!host.querySelector('[aria-current]'), 'A search result must not be mistaken for current progress');
    render(documents, documents[1000].path, '', 'project-a'); await frame();
    check(visible(), 'Clearing search must locate current progress');
    const small = documents.slice(0, 40);
    render(small, small[30].path, small[0].path, 'project-b'); await frame();
    check(visible(), 'Short lists and project switching must locate the actual stage');
    check(host.querySelector('.selected')?.getAttribute('aria-current') === null, 'Selected and current files must remain distinct');
    const scrollTop = list.scrollTop;
    render(small, small[30].path, small[1].path, 'project-b'); await frame();
    check(list.scrollTop === scrollTop, 'Selection changes must preserve manual navigation');
    render(small, undefined, small[1].path, 'project-finished'); await frame();
    check(!host.querySelector('[aria-current]'), 'Completed books must not show a false current stage');
    return { longBookChapters: documents.length, virtualizedAutoLocate: true, stageChangeAutoLocate: true,
      selectionIndependent: true, resizeKeepsCurrentVisible: true, searchAndClear: true, shortListAndProjectSwitch: true, completedNoFalseCurrent: true };
  } finally { root.unmount(); host.remove(); }
}
