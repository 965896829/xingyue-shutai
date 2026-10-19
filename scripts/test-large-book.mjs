import { spawn } from 'node:child_process';

for (const mode of ['seed', 'measure']) {
  const child = spawn(process.execPath, ['--max-old-space-size=1024', '--expose-gc', '--import', 'tsx', 'tests/large-book.ts', ...process.argv.slice(2).filter(arg => !arg.startsWith('--mode=')), `--mode=${mode}`], { stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) { process.exitCode = code ?? 1; break; }
}
