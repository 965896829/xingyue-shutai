export function jumpToChatTarget(root: HTMLElement | null, id: string) {
  const target = document.getElementById(id);
  if (!root || !target || !root.contains(target)) return false;
  for (let parent: HTMLElement | null = target; parent && parent !== root; parent = parent.parentElement)
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
  root.scrollTo({ top: root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - 12, behavior: 'instant' });
  return true;
}
