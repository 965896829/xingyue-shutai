import type { MouseEvent } from 'react';

export function handleMarkdownLink(event: MouseEvent<HTMLElement>, open: (url: string) => void) {
  const anchor = (event.target as HTMLElement).closest('a');
  if (!anchor) return;
  event.preventDefault();
  const url = anchor.getAttribute('href') ?? '';
  if (/^https?:\/\//i.test(url)) open(url);
}
