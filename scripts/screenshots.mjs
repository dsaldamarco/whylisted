/**
 * Captures the README screenshots in real Firefox with the extension loaded.
 *
 *   node scripts/screenshots.mjs
 *
 * Uses the same fixture as the e2e test (a real public Watchlist and film
 * page, served at their real URLs without Letterboxd's scripts) and writes
 * docs/screenshots/{watchlist,editor,film-page}.png. Crops are kept to the
 * poster grid so nobody's profile appears in them.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPage } from "../tests/fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const WATCHLIST = process.env.WATCHLIST || "https://letterboxd.com/dave/watchlist/";
const FIREFOX =
  process.env.FIREFOX_PATH ||
  ["C:/Program Files/Mozilla Firefox/firefox.exe", "/Applications/Firefox.app/Contents/MacOS/firefox", "/usr/bin/firefox"].find(existsSync);

const NOTES = [
  "Recommended by Marco.",
  "Saw a clip on YouTube and loved the cinematography.",
  "Watch this before the sequel.",
  "For the next movie night.",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const routes = { [WATCHLIST]: await buildPage(WATCHLIST) };
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true });
await browser.installExtension(ROOT);
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
await page.setRequestInterception(true);
page.on("request", (req) => {
  const body = routes[req.url().split("#")[0]];
  if (body) return req.respond({ status: 200, contentType: "text/html; charset=utf-8", body });
  if (req.url().startsWith("https://letterboxd.com/")) return req.abort();
  return req.continue();
});

async function open(url) {
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(".whylisted-badge");
  // Wait for poster images (including fallbacks) to finish loading; other images may be lazy.
  await page.waitForFunction(() => [...document.querySelectorAll(".film-poster img")].every((i) => i.complete), { timeout: 30000 });
  await sleep(800);
}

const hostFor = (uid) => `.whylisted-host:has([data-production-uid="${uid}"])`;

async function openEditor(uid) {
  await page.hover(`${hostFor(uid)} .film-poster`);
  await sleep(300);
  await page.click(`${hostFor(uid)} .whylisted-badge`);
  await page.waitForSelector(".whylisted-pop.-open");
  await sleep(500);
}

async function addNote(uid, text) {
  await openEditor(uid);
  await page.keyboard.type(text);
  await page.keyboard.down("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Control");
  await sleep(700);
}

await open(WATCHLIST);

// Films whose poster image actually loaded, in grid order.
const films = await page.$$eval(".whylisted-host", (hosts) =>
  hosts
    .map((h) => ({
      uid: h.querySelector("[data-production-uid]")?.getAttribute("data-production-uid"),
      slug: h.querySelector("[data-item-slug]")?.getAttribute("data-item-slug"),
      ok: (() => {
        const img = h.querySelector("img.image");
        return img && img.naturalWidth > 0 && !img.currentSrc.includes("empty-poster");
      })(),
    }))
    .map((f, index) => ({ ...f, index }))
);
const cols = await page.$eval(".poster-grid .grid", (g) => getComputedStyle(g).gridTemplateColumns.split(" ").length);
const good = films.filter((f) => f.ok);
const row = (f) => Math.floor(f.index / cols);
// Two notes in the first row, two in the second; the tooltip goes on a second-row poster.
const picks = [...good.filter((f) => row(f) === 0).slice(1, 3), ...good.filter((f) => row(f) === 1).slice(1, 3)];

for (const [i, f] of picks.entries()) await addNote(f.uid, NOTES[i]);

// The first two rows of the grid, with a small margin (not enough to show the heading above).
const clip = await page.$eval(
  ".poster-grid",
  (g, cols) => {
    const items = g.querySelectorAll("li");
    const top = items[0].getBoundingClientRect();
    const bottom = items[cols].getBoundingClientRect();
    const r = g.getBoundingClientRect();
    return { x: r.left + scrollX - 20, y: top.top + scrollY - 14, width: r.width + 40, height: bottom.bottom - top.top + 28 };
  },
  cols
);

// 1. Watchlist with notes, one previewed on hover.
await page.evaluate(() => document.activeElement?.blur());
await page.hover(`${hostFor(picks[2].uid)} .whylisted-badge`);
await sleep(700);
await page.screenshot({ path: join(OUT, "watchlist.png"), clip });
console.log("wrote watchlist.png");

// 2. Writing a new note.
await page.mouse.move(2, 2);
await sleep(400);
const target = good.find((f) => row(f) === 0 && !picks.includes(f) && f.index < cols - 2) ?? good[0];
await openEditor(target.uid);
await page.keyboard.type("Apparently one of the best sci-fi films ever made. Ask Giulia for her copy.", { delay: 0 });
await sleep(300);
await page.screenshot({ path: join(OUT, "editor.png"), clip });
console.log("wrote editor.png");
await page.keyboard.press("Escape");

// 3. The same note on the film's own page.
const filmUrl = `https://letterboxd.com/film/${picks[0].slug}/`;
routes[filmUrl] = await buildPage(filmUrl);
await open(filmUrl);
await openEditor(picks[0].uid);
const cover = await page.$eval("#js-poster-col", (c) => {
  const r = c.querySelector(".poster-list").getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, height: r.height };
});
await page.screenshot({
  path: join(OUT, "film-page.png"),
  clip: { x: cover.x - 24, y: cover.y - 32, width: 820, height: cover.height + 64 },
});
console.log("wrote film-page.png");

await browser.close();
