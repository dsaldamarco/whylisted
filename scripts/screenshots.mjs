/**
 * Captures the README screenshots in real Firefox with the extension loaded.
 *
 *   node scripts/screenshots.mjs
 *
 * Uses the same fixture as the e2e test (a real public Watchlist and film
 * page, served at their real URLs without Letterboxd's scripts) and writes
 * docs/screenshots/{watchlist,editor,film-page}.png. FILM_SLUG picks the film
 * for the film-page shot. Crops are kept to the
 * poster grid so nobody's profile appears in them.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPage, posterFor } from "../tests/fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const WATCHLIST = process.env.WATCHLIST || "https://letterboxd.com/dave/watchlist/";
const FIREFOX =
  process.env.FIREFOX_PATH ||
  ["C:/Program Files/Mozilla Firefox/firefox.exe", "/Applications/Firefox.app/Contents/MacOS/firefox", "/usr/bin/firefox"].find(existsSync);

/**
 * What each screenshot shows. Notes are matched to films they make sense for
 * ([REC] really does have a sequel; Belle is animated).
 */
const SCENES = {
  watchlist: {
    url: "https://letterboxd.com/dave/watchlist/page/5/",
    notes: {
      kokuho: "Recommended by Marco.",
      "belle-2021": "Saw a clip on YouTube and loved the animation.",
      rec: "Watch this before the sequel.",
      "la-grazia": "For the next movie night.",
    },
    preview: "rec",
    // Other visible films with a custom poster the fixture can't guess.
    extraPosters: ["crumb"],
  },
  editor: {
    url: WATCHLIST,
    film: "la-gradiva",
    text: "Apparently everyone loved this movie. Saw a lot of reels on socials recommending it.",
  },
  filmPage: {
    film: process.env.FILM_SLUG || "hard-boiled",
    text: "Recommended by Vincenzo.",
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const routes = {};
const serve = async (url, options) => (routes[url] ??= await buildPage(url, options));
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

const hostForSlug = (slug) => `.whylisted-host:has([data-item-slug="${slug}"])`;
const uidOf = (slug) => page.$eval(`${hostForSlug(slug)} [data-production-uid]`, (el) => el.getAttribute("data-production-uid"));

/** The first two rows of the grid, with a small margin (not enough to show the heading above). */
const gridClip = () =>
  page.$eval(".poster-grid .grid", (g) => {
    const cols = getComputedStyle(g).gridTemplateColumns.split(" ").length;
    const items = g.querySelectorAll("li");
    const top = items[0].getBoundingClientRect();
    const bottom = items[cols].getBoundingClientRect();
    const r = g.getBoundingClientRect();
    return { x: r.left + scrollX - 20, y: top.top + scrollY - 14, width: r.width + 40, height: bottom.bottom - top.top + 28 };
  });

// 1. A Watchlist with notes, one previewed on hover.
{
  const { url, notes, preview, extraPosters = [] } = SCENES.watchlist;
  // Films with a note need their real poster (some have custom ones the fixture can't guess).
  const posters = {};
  for (const slug of [...Object.keys(notes), ...extraPosters]) {
    const src = await posterFor(slug);
    if (src) posters[slug] = src;
    await sleep(500);
  }
  await serve(url, { posters });
  await open(url);
  for (const [slug, text] of Object.entries(notes)) await addNote(await uidOf(slug), text);
  const clip = await gridClip();
  await page.evaluate(() => document.activeElement?.blur());
  // Scroll the grid to the top of the viewport so a first-row tooltip opens downwards, inside the crop.
  await page.evaluate((y) => window.scrollTo(0, y), clip.y);
  await page.hover(`${hostForSlug(preview)} .whylisted-badge`);
  await sleep(700);
  // Widen the crop if the tooltip reaches past the grid (it does for a last-column poster).
  const tip = await page.$eval(".whylisted-tip", (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left + scrollX, right: r.right + scrollX };
  });
  const right = Math.max(clip.x + clip.width, tip.right + 16);
  clip.x = Math.min(clip.x, tip.left - 16);
  clip.width = right - clip.x;
  await page.screenshot({ path: join(OUT, "watchlist.png"), clip });
  console.log("wrote watchlist.png");
}

// 2. Writing a new note.
{
  const { url, film, text } = SCENES.editor;
  await serve(url);
  await open(url);
  await openEditor(await uidOf(film));
  await page.keyboard.type(text);
  await sleep(300);
  await page.screenshot({ path: join(OUT, "editor.png"), clip: await gridClip() });
  console.log("wrote editor.png");
  await page.keyboard.press("Escape");
}

// 3. A note on a film's own page.
{
  const { film, text } = SCENES.filmPage;
  const url = `https://letterboxd.com/film/${film}/`;
  await serve(url);
  await open(url);
  const uid = await page.$eval("#js-poster-col [data-production-uid]", (el) => el.getAttribute("data-production-uid"));
  await addNote(uid, text);
  await page.mouse.move(2, 2);
  await openEditor(uid);
  const cover = await page.$eval("#js-poster-col", (c) => {
    const r = c.querySelector(".poster-list").getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, height: r.height };
  });
  await page.screenshot({
    path: join(OUT, "film-page.png"),
    clip: { x: cover.x - 24, y: cover.y - 32, width: 820, height: cover.height + 64 },
  });
  console.log("wrote film-page.png");
}

await browser.close();
