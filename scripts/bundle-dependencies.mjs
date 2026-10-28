import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = file => file.replaceAll('\\', '/');
const externalAllowed = name => name === 'electron' || isBuiltin(name);

/** The packaged app has no node_modules fallback: fail the build if one becomes necessary. */
export function verifyBundledDependencies(metafile) {
  const external = new Set(), dependencies = new Map();
  const rememberPackage = file => {
    const absolute = path.resolve(file), normalized = portable(absolute);
    const match = normalized.match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/);
    if (!match) return;
    const directory = fs.realpathSync(match[1]);
    if (!fs.existsSync(path.join(directory, 'package.json'))) throw new Error(`Missing package metadata: ${file}`);
    dependencies.set(directory, JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')));
  };
  for (const file of Object.keys(metafile.inputs)) rememberPackage(file);
  // Some npm distributions (for example docx) already contain bundled child code.
  // Keep the production dependency closure's notices as well as direct build inputs.
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  for (const [directory, metadata] of Object.entries(lock.packages))
    if (directory && !metadata.dev && fs.existsSync(path.join(directory, 'package.json')))
      rememberPackage(path.join(directory, 'package.json'));
  for (const [file, output] of Object.entries(metafile.outputs)) {
    for (const dependency of output.imports) {
      if (!dependency.external) continue;
      if (!externalAllowed(dependency.path)) throw new Error(`Unbundled runtime dependency: ${file} -> ${dependency.path}`);
      external.add(dependency.path);
    }
    if (!file.endsWith('.cjs')) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = node => {
      // Also cover fflate's createRequire alias, which is not an esbuild import.
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(?:__)?require\d*$/.test(node.expression.text)) {
        const value = node.arguments[0];
        if (!value || !ts.isStringLiteralLike(value) || !externalAllowed(value.text))
          throw new Error(`Runtime require needs review before packaging: ${file}: ${node.getText(source)}`);
        external.add(value.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  // Vite has already run. Its maps identify the renderer packages actually bundled.
  const maps = fs.readdirSync('dist/assets').filter(file => file.endsWith('.js.map'));
  if (!maps.length) throw new Error('Build the renderer before collecting its dependency notices');
  for (const file of maps) {
    const mapFile = path.resolve('dist/assets', file), map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    for (const source of map.sources) rememberPackage(path.resolve(path.dirname(mapFile), map.sourceRoot ?? '', source));
  }

  const vendorSources = JSON.parse(fs.readFileSync('resources/licenses/sources.json', 'utf8'));
  const noticeRoot = path.resolve('dist/third-party-licenses'), notices = [];
  fs.mkdirSync(noticeRoot, { recursive: true });
  for (const [directory, metadata] of [...dependencies].sort(([a], [b]) => a.localeCompare(b))) {
    const identity = `${metadata.name}@${metadata.version}`;
    const candidates = fs.readdirSync(directory).filter(file => /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(file) && fs.statSync(path.join(directory, file)).isFile());
    let texts = candidates.map(file => ({ name: file, source: path.join(directory, file) }));
    const pinned = vendorSources[identity];
    if (!texts.length && pinned) texts = [{ name: path.basename(pinned.file), source: path.join('resources/licenses', pinned.file) }];
    if (!texts.length) {
      const readme = fs.readdirSync(directory).find(file => /^readme(?:\.|$)/i.test(file) && fs.statSync(path.join(directory, file)).isFile());
      if (readme && /permission is hereby granted|redistribution and use|apache license/i.test(fs.readFileSync(path.join(directory, readme), 'utf8')))
        texts = [{ name: readme, source: path.join(directory, readme) }];
    }
    if (!texts.length) throw new Error(`No redistributable license text found for ${identity}`);
    const destination = path.join(noticeRoot, identity.replaceAll('/', '__'));
    fs.mkdirSync(destination, { recursive: true });
    const files = texts.map(({ name, source }) => {
      const bytes = fs.readFileSync(source);
      fs.writeFileSync(path.join(destination, name), bytes);
      return { file: portable(path.relative(noticeRoot, path.join(destination, name))), sha256: digest(bytes) };
    });
    notices.push({ name: metadata.name, version: metadata.version, license: metadata.license ?? null, repository: metadata.repository ?? null, ...(pinned ? { source: pinned.source } : {}), files });
  }
  fs.writeFileSync(path.join(noticeRoot, 'index.json'), JSON.stringify(notices, null, 2) + '\n');
  fs.mkdirSync('.test-output', { recursive: true });
  const report = { externalRuntimeModules: [...external].sort(), dependencyNotices: notices, packagedNodeModules: false };
  fs.writeFileSync('.test-output/bundle-dependencies.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`Verified bundled runtime; preserved notices for ${notices.length} packages`);
}
