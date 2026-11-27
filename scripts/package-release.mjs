import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopArtifacts } from './desktop-artifacts.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'release', 'signed');
const env = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1' };
function run(file, args) {
  execFileSync(file, args, { cwd: root, env, stdio: 'inherit' });
}
function release() {
  const mac = process.platform === 'darwin';
  if (!mac && process.platform !== 'win32') throw Error('请在目标 Mac 或 Windows 上构建发行版');
  const flags = ['-c.forceCodeSigning=true', '-c.directories.output=' + output, '--publish', 'never'];
  if (mac) {
    const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    const available = [...identities.matchAll(/\b([A-F0-9]{40}) "Developer ID Application:/gi)];
    const identity = env.CSC_NAME || (available.length === 1 && available[0][1]);
    if (!identity || identity === '-') throw Error('正式发行需要指定 Developer ID Application 签名身份，或在钥匙串中提供唯一的有效发行证书');
    if (!(env.APPLE_KEYCHAIN_PROFILE || (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) ||
          (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)))
      throw Error('正式发行需要配置 Apple 公证账户、API 密钥或已保存的公证凭据');
    flags.push('--mac', 'dmg', 'zip', '--' + process.arch, '-c.mac.identity=' + identity, '-c.mac.notarize=true');
  } else {
    flags.push('--config', 'scripts/windows-builder.cjs', '--win', 'nsis', '--x64', '-c.win.signExecutable=true');
  }
  run(process.execPath, [path.join(root, 'scripts/doctor.mjs')]);
  run(process.execPath, [env.npm_execpath, 'run', 'build']);
  run(process.execPath, [require.resolve('electron-builder/cli.js'), ...flags]);
  const { executable, installer, resources } = desktopArtifacts(output);
  if (mac) {
    const app = path.resolve(resources, '../..');
    run('codesign', ['--verify', '--deep', '--strict', '-R=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists', app]);
    run('xcrun', ['stapler', 'validate', app]);
  } else {
    for (const file of [executable, installer]) {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "if ((Get-AuthenticodeSignature -LiteralPath $env:XINGYUE_SIGNED_FILE).Status -ne 'Valid') { exit 1 }"],
        { env: { ...env, XINGYUE_SIGNED_FILE: file }, stdio: 'inherit' });
    }
  }
  console.log('发行签名验证通过。产物目录 ' + output);
}
try { release(); } catch (error) { console.error(error.message); process.exitCode = 1; }
