const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'resources/brand/generated');
const publicDir = path.join(root, 'public/brand');
const iconsDir = path.join(root, 'resources/brand/icons');
const profile = path.join(root, '.test-output/brand-export-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.disableHardwareAcceleration();

function alphaReport(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  if (bitmap.length !== width * height * 4) throw new Error('Unexpected native bitmap layout');
  let minX = width, minY = height, maxX = -1, maxY = -1;
  let transparent = 0, translucent = 0, opaque = 0, edgePixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = bitmap[(y * width + x) * 4 + 3];
      if (alpha === 0) { transparent++; continue; }
      if (alpha === 255) opaque++; else translucent++;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgePixels++;
    }
  }
  if (maxX < 0) throw new Error('Image has no visible pixels');
  return {
    width, height,
    alphaBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    transparent, translucent, opaque, edgePixels
  };
}

function load(name) {
  const file = path.join(sourceDir, `${name}.png`);
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error(`Unable to load ${name}`);
  const source = alphaReport(image);
  if (source.transparent === 0) throw new Error(`${name} has no transparency; background removal is not part of export`);
  return {
    image: image.crop(source.alphaBounds),
    source: { ...source, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
  };
}

function place(image, width, height, x, y) {
  const size = image.getSize();
  if (x < 0 || y < 0 || x + size.width > width || y + size.height > height)
    throw new Error('Image would be clipped by its output canvas');
  const input = image.toBitmap(), output = Buffer.alloc(width * height * 4);
  for (let row = 0; row < size.height; row++) {
    input.copy(output, ((y + row) * width + x) * 4, row * size.width * 4, (row + 1) * size.width * 4);
  }
  return nativeImage.createFromBitmap(output, { width, height, scaleFactor: 1 });
}

function symbol(image) {
  const { width, height } = image.getSize();
  const scale = Math.min(464 / width, 456 / height);
  const resized = image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' });
  // Resampling can turn subpixel alpha specks into fully transparent pixels.
  // Trim only those transparent margins so the visible lower anchor is identical.
  const fitted = resized.crop(alphaReport(resized).alphaBounds);
  const size = fitted.getSize();
  // All symbols share the same center and 480px lower anchor, preserving every nontransparent pixel.
  return place(fitted, 512, 512, Math.floor((512 - size.width) / 2), 480 - size.height);
}

function applicationIcon(image, size) {
  // Render each Windows size from the cropped original, without carrying the
  // sidebar symbol's padding and lower anchor into the taskbar icon.
  const inset = Math.max(1, Math.round(size / 128));
  const source = image.getSize();
  const scale = Math.min((size - inset * 2) / source.width, (size - inset * 2) / source.height);
  const resized = image.resize({
    width: Math.round(source.width * scale),
    height: Math.round(source.height * scale),
    quality: 'best'
  });
  const fitted = resized.crop(alphaReport(resized).alphaBounds);
  const bounds = fitted.getSize();
  return place(fitted, size, size, Math.floor((size - bounds.width) / 2), Math.floor((size - bounds.height) / 2));
}

function wordmark(image) {
  const { width, height } = image.getSize();
  const resized = image.resize({ width: 1024, height: Math.round(height * 1024 / width), quality: 'best' });
  const fitted = resized.crop(alphaReport(resized).alphaBounds);
  const size = fitted.getSize();
  return place(fitted, size.width + 16, size.height + 16, 8, 8);
}

function writePNG(file, image) {
  const png = image.toPNG();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  const decoded = nativeImage.createFromBuffer(png);
  const output = alphaReport(decoded);
  if (output.edgePixels > 0) throw new Error(`${file} contains visible pixels on the canvas edge`);
  return { file: path.relative(root, file).replaceAll('\\', '/'), ...output, sha256: crypto.createHash('sha256').update(png).digest('hex') };
}

function writeICO(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  const entries = images.map(({ size, image }, index) => {
    const png = image.toPNG(), start = 6 + index * 16;
    header[start] = size === 256 ? 0 : size;
    header[start + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, start + 4);
    header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(png.length, start + 8);
    header.writeUInt32LE(offset, start + 12);
    offset += png.length;
    return png;
  });
  const ico = Buffer.concat([header, ...entries]);
  const file = path.join(root, 'resources/icon.ico');
  fs.writeFileSync(file, ico);
  return { file: 'resources/icon.ico', sizes: images.map(({ size }) => size), sha256: crypto.createHash('sha256').update(ico).digest('hex') };
}

app.whenReady().then(() => {
  const report = { sources: {}, outputs: [], ico: null };
  let appArtwork;
  for (const name of ['app-icon', 'night-symbol', 'day-symbol']) {
    const loaded = load(name);
    const image = name === 'app-icon' ? applicationIcon(loaded.image, 512) : symbol(loaded.image);
    report.sources[name] = loaded.source;
    report.outputs.push(writePNG(path.join(publicDir, `${name}.png`), image));
    if (name === 'app-icon') appArtwork = loaded.image;
  }
  const loadedWordmark = load('wordmark'), image = wordmark(loadedWordmark.image);
  report.sources.wordmark = loadedWordmark.source;
  // One silhouette serves both themes; CSS controls its ink color.
  report.outputs.push(writePNG(path.join(publicDir, 'wordmark-day.png'), image));
  const icoImages = [16, 24, 32, 48, 64, 128, 256].map((size) => ({
    size, image: applicationIcon(appArtwork, size)
  }));
  for (const { size, image } of icoImages)
    report.outputs.push(writePNG(path.join(iconsDir, `app-icon-${size}.png`), image));
  report.ico = writeICO(icoImages);
  fs.writeFileSync(path.join(root, 'resources/brand/export-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputs: report.outputs.length, icoSizes: report.ico.sizes, report: 'resources/brand/export-report.json' }));
  app.exit(0);
}).catch((error) => {
  console.error(error.stack || String(error));
  app.exit(1);
});
