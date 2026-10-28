import { useSyncExternalStore } from 'react';

export const currentRoute = () => {
  const hash = location.hash.slice(1);
  return hash.startsWith('/admin/') ? hash : '/admin/dashboard';
};
const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};
export function usePathname() { return useSyncExternalStore(subscribe, () => currentRoute().split('?')[0]); }
export function navigate(path: string) {
  location.hash = path.startsWith('/admin/') ? path : '/admin/novel/projects';
}
export function useRouter() { return { push: navigate, replace: navigate, refresh: () => window.dispatchEvent(new Event('management:refresh')), back: () => history.back() }; }
