import type { AnchorHTMLAttributes } from 'react';
import { navigate } from './router';
export default function Link({ href, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const internal = href.startsWith('/');
  return <a {...rest} href={internal ? `#${href.startsWith('/admin/') ? href : '/admin/novel/projects'}` : href} onClick={event => {
    onClick?.(event);
    if (internal && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate(href); }
  }}>{children}</a>;
}
