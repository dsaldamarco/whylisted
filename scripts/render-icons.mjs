/**
 * Renders icons/icon.svg to PNG with Firefox (transparent background).
 *
 *   node scripts/render-icons.mjs [--preview out.png]
 *
 * Writes docs/logo.png (README; the extension itself uses the SVG). With
 * --preview, also writes a sheet showing the icon at several sizes on dark
 * and light backgrounds.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIREFOX =
  process.env.FIREFOX_PATH ||
  ["C:/Program Files/Mozilla Firefox/firefox.exe", "/Applications/Firefox.app/Contents/MacOS/firefox", "/usr/bin/firefox"].find(existsSync);
const svg = readFileSync(join(ROOT, "icons", "icon.svg"), "utf8");
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true });
const page = await browser.newPage();

/** Draws the SVG onto a canvas in the page and exports it, so the PNG keeps its transparency. */
async function render(size, out) {
  const png = await page.evaluate(
    (src, size) =>
      new Promise((done, fail) => {
        const img = new Image(size, size);
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          canvas.getContext("2d").drawImage(img, 0, 0, size, size);
          done(canvas.toDataURL("image/png").split(",")[1]);
        };
        img.onerror = fail;
        img.src = src;
      }),
    dataUrl,
    size
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(png, "base64"));
  console.log("wrote", out);
}

await render(256, join(ROOT, "docs", "logo.png"));

const previewIndex = process.argv.indexOf("--preview");
if (previewIndex > -1) {
  const sizes = [16, 32, 48, 96, 192];
  const row = (bg) =>
    `<div style="background:${bg};display:flex;align-items:end;gap:24px;padding:24px">` +
    sizes.map((s) => `<img src="${dataUrl}" width="${s}" height="${s}">`).join("") +
    `</div>`;
  await page.setViewport({ width: 520, height: 520, deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0">${row("#14181c")}${row("#f9f9fb")}${row("#2b2a33")}</body>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const out = process.argv[previewIndex + 1];
  await page.screenshot({ path: out, fullPage: true });
  console.log("wrote", out);
}

await browser.close();
