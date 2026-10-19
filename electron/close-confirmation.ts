import { randomUUID } from 'node:crypto';

/** A close request can only be accepted once, by the dialog for that request. */
export class CloseConfirmation {
  pending: string | null = null;
  approved = false;

  request() {
    if (this.approved) return null;
    return (this.pending ??= randomUUID());
  }

  respond(id: string, action: 'cancel' | 'quit') {
    if (!this.pending || id !== this.pending || this.approved) return false;
    this.pending = null;
    this.approved = action === 'quit';
    return true;
  }
}
