/**
 * Builds the images for the addons.mozilla.org listing.
 *
 *   node scripts/amo-assets.mjs
 *
 * - amo/icon-128.png              the add-on icon (AMO wants a 128×128 PNG)
 * - amo/screenshots/*.png         the README screenshots fitted to 1280×800,
 *                                 AMO's recommended size (1.6:1), centred on
 *                                 Letterboxd's background colour so nothing is cropped
 *
 * Run `npm run screenshots` first if the README screenshots need refreshing.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "amo");
const SHOTS_IN = join(ROOT, "docs", "screenshots");
const SHOTS_OUT = join(OUT, "screenshots");
const FIREFOX =
  process.env.FIREFOX_PATH ||
  ["C:/Program Files/Mozilla Firefox/firefox.exe", "/Applications/Firefox.app/Contents/MacOS/firefox", "/usr/bin/firefox"].find(existsSync);

const W = 1280;
const H = 800;
const MARGIN = 40;
const BACKGROUND = "#14181c";

const dataUrl = (path, type) => `data:${type};base64,${readFileSync(path).toString("base64")}`;

const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true });
const page = await browser.newPage();

/** Draws an image onto a canvas in the page and returns the PNG bytes. */
async function draw(src, { width, height, background, margin = 0 }) {
  const base64 = await page.evaluate(
    (src, width, height, background, margin) =>
      new Promise((done, fail) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, width, height);
          }
          const scale = Math.min((width - margin * 2) / img.naturalWidth, (height - margin * 2) / img.naturalHeight);
          const w = Math.round(img.naturalWidth * scale);
          const h = Math.round(img.naturalHeight * scale);
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
          done(canvas.toDataURL("image/png").split(",")[1]);
        };
        img.onerror = fail;
        img.src = src;
      }),
    src,
    width,
    height,
    background,
    margin
  );
  return Buffer.from(base64, "base64");
}

mkdirSync(SHOTS_OUT, { recursive: true });

// The SVG is drawn at 128×128 with a transparent background.
writeFileSync(join(OUT, "icon-128.png"), await draw(dataUrl(join(ROOT, "icons", "icon.svg"), "image/svg+xml"), { width: 128, height: 128 }));
console.log("wrote amo/icon-128.png");

// Listing order: the most telling screenshot first.
const ORDER = ["watchlist.png", "editor.png", "search.png", "film-page.png"];
const files = readdirSync(SHOTS_IN)
  .filter((f) => f.endsWith(".png"))
  .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
for (const [i, file] of files.entries()) {
  const name = `${i + 1}-${file}`;
  writeFileSync(join(SHOTS_OUT, name), await draw(dataUrl(join(SHOTS_IN, file), "image/png"), { width: W, height: H, background: BACKGROUND, margin: MARGIN }));
  console.log(`wrote amo/screenshots/${name}`);
}

await browser.close();
