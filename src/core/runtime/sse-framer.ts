/** Incremental SSE framing. Scan only new text; join a frame only on dispatch.
 * CR, LF and CRLF are line endings, including CRLF split across reads.
 * This is transport framing, never model-specific token/template decoding. */
export class SseFrameLimitError extends Error {}

export class SseFramer {
  private lines: string[] = [];
  private pieces: string[] = [];
  private tail = '';
  private lineLength = 0;
  private frameLength = 0;
  private skipLf = false;

  constructor(private readonly maxCharacters = 8 * 1024 * 1024) {}

  private append(text: string) {
    if (!text) return;
    // Count normalized separators between nonempty lines, not the blank terminator.
    this.frameLength += text.length + (this.lineLength === 0 && this.lines.length ? 1 : 0);
    if (this.frameLength > this.maxCharacters) throw new SseFrameLimitError();
    this.lineLength += text.length;
    this.tail += text;
    // Bound the number of retained fragments even for single-byte transport reads.
    if (this.tail.length >= 4096) {
      this.pieces.push(this.tail);
      this.tail = '';
    }
  }

  private line() {
    const value = this.pieces.length ? this.pieces.join('') + this.tail : this.tail;
    this.pieces = [];
    this.tail = '';
    this.lineLength = 0;
    return value;
  }

  *push(text: string): Generator<string> {
    if (!text) return;
    let start = this.skipLf && text[0] === '\n' ? 1 : 0;
    this.skipLf = false;
    const endings = /\r\n?|\n/g;
    endings.lastIndex = start;
    let match: RegExpExecArray | null;
    while ((match = endings.exec(text))) {
      this.append(text.slice(start, match.index));
      start = endings.lastIndex;
      this.skipLf = match[0] === '\r' && start === text.length;
      if (this.lineLength) this.lines.push(this.line());
      else if (this.lines.length) {
        const frame = this.lines.join('\n');
        this.lines = [];
        this.frameLength = 0;
        // Yield before inspecting later frames: a completed response may end here.
        yield frame;
      }
    }
    this.append(text.slice(start));
  }

  /** Called only at EOF. An unterminated data event cannot complete a model call. */
  hasPendingData() {
    return this.lines.some(line => line.startsWith('data:')) ||
      (this.pieces.length ? this.pieces[0] : this.tail).startsWith('data:');
  }
}
