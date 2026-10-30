export function storageFileName(displayName: string, fallback = '作品') {
  const safe = Array.from(displayName.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')).slice(0, 100).join('').replace(/[. ]+$/, '');
  if (!safe) return fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? '_' + safe : safe;
}
