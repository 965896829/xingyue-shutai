import { lazy, Suspense, type ComponentProps } from 'react';

const ManuscriptEditor = lazy(() => import('./Editor').then(module => ({ default: module.Editor })));
const DocumentDifference = lazy(() => import('./Editor').then(module => ({ default: module.Difference })));

export function Editor(props: ComponentProps<typeof ManuscriptEditor>) {
  return <Suspense fallback={<p role="status">正在打开编辑器…</p>}><ManuscriptEditor {...props} /></Suspense>;
}

export function Difference(props: ComponentProps<typeof DocumentDifference>) {
  return <Suspense fallback={<p role="status">正在打开版本对比…</p>}><DocumentDifference {...props} /></Suspense>;
}
