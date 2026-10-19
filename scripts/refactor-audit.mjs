import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import * as asar from '@electron/asar';

const base = path.resolve('.test-output/refactor/baseline-source');
const baseline = new Map(JSON.parse(fs.readFileSync('.test-output/refactor/baseline/files.json', 'utf8')).map(row => [path.resolve(row.Path), row.Hash.toLowerCase()]));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
function inspect(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ranges = new Map(), ui = [];
  const visit = node => {
    for (const range of [...ts.getLeadingCommentRanges(source, node.pos) ?? [], ...ts.getTrailingCommentRanges(source, node.end) ?? []]) ranges.set(range.pos, source.slice(range.pos, range.end));
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) ui.push({ tag: node.tagName.getText(ast), attributes: node.attributes.properties.filter(prop => !ts.isJsxAttribute(prop) || !prop.name.getText(ast).startsWith('on')).map(prop => ts.isJsxAttribute(prop) ? [prop.name.getText(ast), prop.initializer && ts.isStringLiteral(prop.initializer) ? prop.initializer.text : null] : ['spread']) });
    if (ts.isJsxText(node) && node.text.trim()) ui.push({ text: node.text.replace(/\s+/g, ' ').trim() });
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { comments: [...ranges.values()], ui };
}
const report = { at: new Date().toISOString(), ui: [], comments: [], assets: [], architecture: [], package: {} };
for (const file of [...files('src'), ...files('electron')]) {
  const absolute = path.resolve(file), bytes = fs.readFileSync(file), old = baseline.get(absolute);
  if (/\.(css|png|svg|ico)$/.test(file) && old) report.assets.push({ file, unchanged: old === digest(bytes) });
  if (!/\.tsx?$/.test(file)) continue;
  const source = bytes.toString('utf8'), current = inspect(file, source);
  if (file.startsWith('src' + path.sep + 'ui') && /from ['"].*core\//.test(source)) report.architecture.push(file);
  const original = path.join(base, file);
  if (fs.existsSync(original)) {
    const prior = inspect(file, fs.readFileSync(original, 'utf8'));
    if (file.endsWith('.tsx')) report.ui.push({ file, elementsAndLabelsUnchanged: JSON.stringify(current.ui) === JSON.stringify(prior.ui), elements: current.ui.length });
    const remaining = [...prior.comments];
    const added = current.comments.filter(comment => { const index = remaining.indexOf(comment); if (index < 0) return true; remaining.splice(index, 1); return false; });
    report.comments.push({ file, added: added.length, ...(added.length ? { text: added } : {}) });
  } else if (!old) report.comments.push({ file, added: current.comments.length, ...(current.comments.length ? { text: current.comments } : {}) });
}
for (const [file, expected] of baseline) if (/[/\\](public|resources)[/\\]/.test(file) && /\.(png|svg|ico)$/.test(file)) report.assets.push({ file: path.relative(process.cwd(), file), unchanged: fs.existsSync(file) && digest(fs.readFileSync(file)) === expected });
const archive = path.resolve(process.env.WENXU_RELEASE_DIR ?? 'release/refactor', 'win-unpacked/resources/app.asar');
if (fs.existsSync(archive)) {
  const entries = asar.listPackage(archive);
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const fixtures = ['fixture-only-secret', 'fixture-reasoning-signature', 'pi-independent-draft'];
  report.package = { version: pkg.version, name: pkg.name, configuredAppId: JSON.parse(fs.readFileSync('package.json', 'utf8')).build.appId, archiveHash: digest(fs.readFileSync(archive)), piFiles: entries.filter(entry => /[\\/](?:@mariozechner|@earendil-works)[\\/]/.test(entry)), testSecrets: [], bundles: [] };
  for (const file of ['main', 'preload', 'worker', 'document-worker'].filter(name => fs.existsSync(`dist-electron/${name}.cjs`))) {
    const content = asar.extractFile(archive, `dist-electron/${file}.cjs`).toString('utf8');
    for (const value of fixtures) if (content.includes(value)) report.package.testSecrets.push({ file, value });
    const matches = digest(content) === digest(fs.readFileSync(`dist-electron/${file}.cjs`));
    report.package.bundles.push({ file, matches });
    if (file === 'worker') report.package.workerMatches = matches;
  }
}
const output = process.env.WENXU_AUDIT_OUTPUT ?? 'docs/refactor/test-evidence/source-audit.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
const failures = { ui: report.ui.filter(row => !row.elementsAndLabelsUnchanged), comments: report.comments.filter(row => row.added), assets: report.assets.filter(row => !row.unchanged), architecture: report.architecture, package: report.package };
console.log(JSON.stringify({ ...failures, counts: { ui: report.ui.length, comments: report.comments.length, assets: report.assets.length } }, null, 2));
if (failures.ui.length || failures.comments.length || failures.assets.length || failures.architecture.length || report.package.piFiles?.length || report.package.testSecrets?.length || report.package.bundles?.some(row => !row.matches)) process.exitCode = 1;
