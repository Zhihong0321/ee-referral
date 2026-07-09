import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const AMBER = "#d97706";
const CREAM = "#F9F8F6";

function iconSvg({ size, padding = 0 }) {
  const inner = size - padding * 2;
  const fontSize = Math.round(inner * 0.42);
  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="${AMBER}"/>
  <text
    x="50%"
    y="50%"
    text-anchor="middle"
    dominant-baseline="central"
    font-family="Arial, Helvetica, sans-serif"
    font-weight="700"
    font-size="${fontSize}"
    fill="${CREAM}"
  >EE</text>
</svg>`;
}

async function render(name, size, { maskable = false } = {}) {
  const padding = maskable ? Math.round(size * 0.12) : 0;
  const svg = iconSvg({ size, padding });
  await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, name));
  console.log(`wrote ${name}`);
}

await render("icon-192.png", 192);
await render("icon-512.png", 512);
await render("icon-maskable-512.png", 512, { maskable: true });
await render("apple-touch-icon.png", 180);
