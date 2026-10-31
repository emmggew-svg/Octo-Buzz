#!/usr/bin/env node
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const W = 1024;
const H = 1024;
const px = new Float32Array(W * H * 4);

const over = (x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const da = px[i + 3];
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  px[i] = (r * a + px[i] * da * (1 - a)) / oa;
  px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / oa;
  px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / oa;
  px[i + 3] = oa;
};

const ellipse = (cx, cy, rx, ry, rot, color) => {
  const [r, g, b, alpha = 1] = color;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  const x0 = Math.max(0, Math.floor(cx - rx - 2));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx + 2));
  const y0 = Math.max(0, Math.floor(cy - ry - 2));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry + 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = (dx * cos - dy * sin) / rx;
      const ly = (dx * sin + dy * cos) / ry;
      const d = Math.hypot(lx, ly);
      const aa = 1.5 / Math.min(rx, ry);
      const a = Math.min(1, Math.max(0, (1 - d) / aa)) * alpha;
      if (a > 0) over(x, y, r, g, b, a);
    }
  }
};

const circle = (cx, cy, rad, color) => ellipse(cx, cy, rad, rad, 0, color);

const tentacle = (x0, y0, cx, cy, x1, y1, r0, r1, color) => {
  const n = 120;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    circle(x, y, r0 + (r1 - r0) * t, color);
  }
};

const PURPLE = [109, 40, 217];
const VIOLET = [124, 58, 237];
const LIGHT = [139, 92, 246];

for (let i = 0; i < 8; i++) {
  const off = i - 3.5;
  const side = i < 4 ? -1 : 1;
  const spread = Math.abs(off) / 3.5;
  const rootX = 512 + off * 54;
  const rootY = 590;
  const ctrlX = 512 + off * 96 + side * 24 * spread;
  const ctrlY = 760;
  const endX = 512 + off * 138 + side * 34 * spread;
  const endY = 800 + (i % 2) * 48 - spread * 20;
  const color = i % 3 === 0 ? PURPLE : i % 3 === 1 ? VIOLET : LIGHT;
  tentacle(rootX, rootY, ctrlX, ctrlY, endX, endY, 46, 12, color);
}

ellipse(512, 430, 246, 236, 0, [...PURPLE, 1]);
ellipse(512, 420, 228, 216, 0, [...VIOLET, 1]);
ellipse(458, 352, 150, 112, -0.4, [167, 139, 250, 0.9]);
ellipse(430, 318, 84, 46, -0.5, [221, 214, 254, 0.75]);

for (const [ex, px2] of [
  [415, 437],
  [609, 587],
]) {
  ellipse(ex, 415, 62, 76, 0, [251, 248, 255, 1]);
  circle(px2, 442, 29, [25, 16, 51]);
  circle(px2 - 9, 428, 11, [255, 255, 255, 0.92]);
  circle(px2 + 8, 455, 4.5, [255, 255, 255, 0.5]);
}

for (const bx of [348, 676]) ellipse(bx, 500, 34, 18, 0, [255, 122, 182, 0.28]);

ellipse(512, 552, 20, 15, 0, [30, 16, 66, 0.9]);
ellipse(512, 556, 9, 6, 0, [255, 140, 195, 0.75]);

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const src = (y * W + x) * 4;
    const dst = y * (W * 4 + 1) + 1 + x * 4;
    raw[dst] = Math.round(Math.min(255, Math.max(0, px[src])));
    raw[dst + 1] = Math.round(Math.min(255, Math.max(0, px[src + 1])));
    raw[dst + 2] = Math.round(Math.min(255, Math.max(0, px[src + 2])));
    raw[dst + 3] = Math.round(Math.min(1, px[src + 3]) * 255);
  }
}

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (bytes) => {
  let c = ~0;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "assets", "icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
