import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

for (const mode of ['seed', 'measure']) {
  const child = spawn(process.execPath, ['--max-old-space-size=1024', '--expose-gc', '--import', 'tsx', 'tests/large-book.ts', ...process.argv.slice(2).filter(arg => !arg.startsWith('--mode=')), `--mode=${mode}`], { stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) { process.exitCode = code ?? 1; break; }
}

// Keep the measurement report. The runner owns the default synthetic manuscript.
if (process.env.XINGYUE_TEST_OUTPUT && !process.argv.slice(2).some(arg => arg.startsWith('--output='))) {
  const file = 'large-book-report.json';
  const report = path.join(process.env.XINGYUE_TEST_OUTPUT, 'large-book', file);
  if (existsSync(report)) {
    const destination = path.resolve('.test-output/large-book');
    mkdirSync(destination, { recursive: true });
    renameSync(report, path.join(destination, file));
  }
}
