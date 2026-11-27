import fs from 'node:fs';
import path from 'node:path';

/** macOS stores extended attributes in sibling files on volumes such as exFAT. */
export function isAppleDouble(directory: string, name: string): boolean {
  if (!name.startsWith('._')) return false;
  const file = path.join(directory, name);
  if (!fs.lstatSync(file).isFile()) return false;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const header = Buffer.alloc(8);
    return fs.readSync(fd, header, 0, header.length, 0) === header.length &&
      header.readUInt32BE(0) === 0x00051607 && header.readUInt32BE(4) === 0x00020000;
  } finally { fs.closeSync(fd); }
}
