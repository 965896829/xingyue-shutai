import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { version, build } = require('../package.json');

export function desktopArtifacts(root = process.env.WENXU_RELEASE_DIR || 'release') {
  const output = path.resolve(root);
  if (process.platform === 'darwin') {
    const folder = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    const contents = path.join(output, folder, build.productName + '.app', 'Contents');
    return {
      resources: path.join(contents, 'Resources'),
      executable: path.join(contents, 'MacOS', build.productName),
      installer: path.join(output, `${build.productName}-${version}-mac-${process.arch}.dmg`)
    };
  }
  if (process.platform === 'win32') {
    const { win } = require('./windows-builder.cjs');
    const folder = path.join(output, 'win-unpacked');
    return {
      resources: path.join(folder, 'resources'),
      executable: path.join(folder, win.executableName + '.exe'),
      installer: path.join(output, `${build.productName} Setup ${version}.exe`)
    };
  }
  throw new Error('此平台没有桌面交付目标');
}
