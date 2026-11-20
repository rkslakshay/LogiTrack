// Turns the raw screenshot captures (test-results/screenshots, written by `npm run screenshots`)
// into the published images:
//   docs/assets/screenshots/<name>.webp   README and documentation (1440 px wide, WebP)
//   public/screenshots/<name>.png         only the images the landing page embeds (next/image
//                                         serves them in modern formats and sizes itself)
// Uses `sharp`, which Next.js already installs. No new dependency.
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const RAW = "test-results/screenshots";
const DOCS = "docs/assets/screenshots";
const PUBLIC = "public/screenshots";
/** Images referenced by src/app/page.tsx. */
const LANDING = new Set(["dashboard", "tracking", "delivery-detail", "routes", "analytics"]);

mkdirSync(DOCS, { recursive: true });
mkdirSync(PUBLIC, { recursive: true });

const files = readdirSync(RAW).filter((f) => f.endsWith(".png")).sort();
if (files.length === 0) {
  console.error(`No captures in ${RAW}. Run: npm run screenshots`);
  process.exit(1);
}
let before = 0;
let after = 0;
for (const file of files) {
  const name = file.replace(/\.png$/, "");
  const src = join(RAW, file);
  before += statSync(src).size;
  const webp = join(DOCS, `${name}.webp`);
  await sharp(src).resize({ width: 1440, withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toFile(webp);
  after += statSync(webp).size;
  if (LANDING.has(name)) {
    await sharp(src).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(join(PUBLIC, `${name}.png`));
  }
  console.log(`${name.padEnd(22)} ${(statSync(webp).size / 1024).toFixed(0).padStart(5)} KB webp${LANDING.has(name) ? "  + landing png" : ""}`);
}
console.log(`\n${files.length} images: ${(before / 1024 / 1024).toFixed(1)} MB raw -> ${(after / 1024 / 1024).toFixed(1)} MB WebP in ${DOCS}`);
