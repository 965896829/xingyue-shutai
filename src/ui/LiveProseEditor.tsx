import type { Run } from '../shared/types';
import { Editor } from './Editor';
import { proseBinding, useLiveStream } from './useLiveStream';

export function LiveProseEditor({ session, run, onSelection }: { session?: string; run: Run; onSelection: (value: string) => void }) {
  const text = useLiveStream(proseBinding(session, run));
  return <div className="live-prose-editor" data-editor-stream-length={text.length}>
    <Editor value={text} readOnly onSelection={onSelection} />
  </div>;
}

export function LiveProseCount({ session, run }: { session?: string; run: Run }) {
  const text = useLiveStream(proseBinding(session, run));
  return <>{Array.from(text.replace(/\s/g, '')).length.toLocaleString()}</>;
}
