import type { CommandOutput, Invoke } from './contracts';

export function mergeRows<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const rows = new Map(previous.map((row) => [row.id, row]));
  next.forEach((row) => rows.set(row.id, row));
  return [...rows.values()];
}

export async function readChatUpdates(invoke: Invoke, id: string, previousWatermark: number) {
  let result: CommandOutput<'chat.page'> = await invoke('chat.page', { id });
  let before = result.nextBefore;
  while (previousWatermark > 0 && before !== null && before > previousWatermark) {
    const page = await invoke('chat.page', { id, before, watermark: result.watermark });
    result = { ...result, messages: mergeRows(page.messages, result.messages), turns: mergeRows(page.turns, result.turns), proposals: mergeRows(page.proposals, result.proposals) };
    before = page.nextBefore;
  }
  return result;
}
