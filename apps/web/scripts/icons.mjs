// Erzeugt die PNG-Icons der PWA aus public/icons/icon.svg: node scripts/icons.mjs
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const dir = new URL('../public/icons/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', dir));
// Maskierbar: Hintergrund randlos, Symbol in der sicheren Zone (80 %)
const maskable = Buffer.from(
  svg
    .toString()
    .replace('rx="112"', 'rx="0"')
    .replace('<g ', '<g transform="translate(51.2 51.2) scale(0.8)" '),
);

const out = [
  [svg, 'icon-192x192.png', 192],
  [svg, 'icon-512x512.png', 512],
  [maskable, 'icon-maskable-512x512.png', 512],
  [maskable, 'apple-touch-icon.png', 180],
  [svg, 'favicon-32.png', 32],
];
for (const [src, name, size] of out) {
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(new URL(name, dir).pathname);
  console.log(name);
}
