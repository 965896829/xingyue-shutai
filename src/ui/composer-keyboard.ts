import type { KeyboardEvent } from 'react';

export function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, enabled: boolean, send: () => void) {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  event.preventDefault();
  if (enabled && !event.repeat) send();
}
