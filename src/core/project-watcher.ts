import fs from 'node:fs';
import type { FileStore } from './storage';

export class ProjectWatcher {
  private watcher?: fs.FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private verification: ReturnType<typeof setInterval>;
  private last = '';
  private observed = '';
  private closed = false;
  constructor(readonly store: FileStore, readonly changed: () => void, readonly failed: (error: unknown) => void) {
    try {
      this.watcher = fs.watch(store.root, { recursive: true }, (_event, filename) => {
        if (filename && /^(?:\.novelclient|node_modules|\.git)(?:[\\/]|$)/.test(String(filename))) return;
        this.hint();
      });
      this.watcher.on('error', (error) => { this.watcher?.close(); this.watcher = undefined; failed(error); this.hint(); });
    } catch (error) { failed(error); }
    this.verification = setInterval(() => this.hint(), 60_000);
    this.verification.unref();
    this.hint();
  }
  hint() {
    if (this.closed) return;
    this.store.invalidateListing();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.verify(), 500);
    this.timer.unref();
  }
  verify() {
    if (this.closed) return;
    this.timer = undefined;
    try {
      const value = this.store.scan().map((document) => `${document.path}:${document.hash}:${document.acceptedHash}`).join('|');
      if (value !== this.observed) { this.observed = value; this.hint(); return; }
      if (value !== this.last) { this.last = value; this.changed(); }
    } catch (error) { this.failed(error); }
  }
  close() {
    this.closed = true;
    this.watcher?.close();
    clearTimeout(this.timer);
    clearInterval(this.verification);
  }
}
