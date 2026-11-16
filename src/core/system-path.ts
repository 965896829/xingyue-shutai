import fs from 'node:fs';
import path from 'node:path';

/** Resolve only macOS's standard root aliases, never an author-created symlink. */
export function resolveSystemPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
  readLink: (file: string) => string = fs.readlinkSync
) {
  if (platform !== 'darwin') return path.resolve(value);
  const resolved = path.posix.resolve(value);
  const alias = '/' + resolved.split('/')[1];
  const destination = alias === '/var' ? '/private/var' : alias === '/tmp' ? '/private/tmp' : undefined;
  if (destination) {
    try {
      // Verify the exact OS target; the caller still checks every resulting ancestor.
      if (path.posix.resolve('/', readLink(alias)) === destination)
        return destination + resolved.slice(alias.length);
    } catch {
      // A missing/nonstandard alias stays unchanged and goes through normal link checks.
    }
  }
  return resolved;
}
