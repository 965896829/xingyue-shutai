import { useEffect, useState } from 'react';
import { invokeCommand } from '../shared/client';
import { bookProfileSchema, type BookProfile, type BookProfileState, type PublishingSnapshot } from '../shared/publishing';
import type { Snapshot } from '../shared/types';
import { BookProfileFields } from './BookProfileFields';
import { Modal } from './Modal';

export function PublishingSettings({ snapshot, onClose, onProposed }: { snapshot: Snapshot; onClose: () => void; onProposed: (id: string) => void }) {
  const [state, setState] = useState<BookProfileState | null>(null), [profile, setProfile] = useState<BookProfile | null>(null);
  const [catalogs, setCatalogs] = useState<PublishingSnapshot[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([invokeCommand('publishing.read', {}), invokeCommand('tags.catalog', {})]).then(([state, catalog]) => {
      if (!active) return; setState(state); setProfile(state.profile); setCatalogs(catalog.publishingSnapshots ?? []);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [snapshot.projectSessionId]);
  return <Modal title="题材与发布分类" onClose={() => { if (!busy) onClose(); }} wide>
    <form className="modal-body form" onSubmit={event => {
      event.preventDefault(); if (!state || !profile || busy || !snapshot.studio?.snapshot?.id) return;
      const parsed = bookProfileSchema.safeParse(profile);
      if (!parsed.success) { setError('请补齐频道主分类，并检查创作题材的长度与数量。'); return; }
      setBusy(true); setError('');
      void invokeCommand('publishing.propose', { profile: parsed.data, baseHash: state.baseHash, snapshotId: snapshot.studio.snapshot.id })
        .then(onProposed).catch(error => setError(error.message)).finally(() => setBusy(false));
    }}>
      {profile ? <BookProfileFields value={profile} onChange={setProfile} snapshots={catalogs} disabled={busy} /> : !error && <p>正在读取分类…</p>}
      {state?.legacy && <p>原有标签保留在作品方案中。这里可单独设置创作题材与发布分类。</p>}
      {error && <p role="alert">{error}</p>}
      <div className="modal-footer"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={!profile || busy}>生成修改候选</button></div>
    </form>
  </Modal>;
}
