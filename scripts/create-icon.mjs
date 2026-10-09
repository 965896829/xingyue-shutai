import fs from 'node:fs';
import zlib from 'node:zlib';
// A source-generated book mark. No downloaded or third-party artwork.
const size = 256,
  raw = Buffer.alloc((size * 4 + 1) * size);
const green = [47, 88, 69],
  paper = [242, 242, 224];
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + 1 + x * 4,
      inside =
        (x >= 38 && x < 218) ||
        (y >= 38 && y < 218) ||
        Math.hypot(x < 128 ? x - 38 : x - 217, y < 128 ? y - 38 : y - 217) <= 38;
    let color = green,
      alpha = inside ? 255 : 0;
    if (x >= 65 && x <= 186 && y >= 58 && y <= 198) {
      color = paper;
      if (x >= 82 && x <= 169 && y >= 74 && y <= 180) color = green;
    }
    if (x >= 82 && x <= 188 && y >= 188 && y <= 193) color = green;
    if (x >= 103 && x <= 151 && ((y >= 103 && y <= 112) || (y >= 128 && y <= 137))) color = paper;
    raw[i] = color[0];
    raw[i + 1] = color[1];
    raw[i + 2] = color[2];
    raw[i + 3] = alpha;
  }
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const type = Buffer.from(name),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  type.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([type, data])), data.length + 8);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
]);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
fs.mkdirSync('resources', { recursive: true });
fs.writeFileSync('resources/icon.png', png);
fs.writeFileSync('resources/icon.ico', Buffer.concat([ico, png]));
