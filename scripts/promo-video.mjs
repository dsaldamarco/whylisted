/**
 * Renders a ~20-second promo video of Whylisted in real Firefox.
 *
 *   node scripts/promo-video.mjs            frames + an HTML preview player
 *   node scripts/promo-video.mjs --mp4      also an H.264 MP4 (needs ffmpeg on PATH, or FFMPEG=path)
 *
 * The extension runs for real on a Letterboxd Watchlist and film page (the
 * same fixture as the e2e test). Each frame is captured with time frozen: CSS
 * transitions and animations are paused and advanced exactly 1/30 s per frame,
 * so motion is smooth regardless of how long a screenshot takes. The cursor,
 * captions and title cards are drawn on top of the page.
 *
 * Output (not committed): promo/frames/*.jpg, promo/preview.html, promo/whylisted-promo.mp4
 */
import puppeteer from "puppeteer-core";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPage, posterFor } from "../tests/fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "promo");
const FRAMES = join(OUT, "frames");
const FIREFOX =
  process.env.FIREFOX_PATH ||
  ["C:/Program Files/Mozilla Firefox/firefox.exe", "/Applications/Firefox.app/Contents/MacOS/firefox", "/usr/bin/firefox"].find(existsSync);

const FPS = 30;
const VIEW = { width: 1280, height: 720, deviceScaleFactor: 1.5 }; // → 1920×1080 frames
const WATCHLIST = "https://letterboxd.com/dave/watchlist/";
const FILM = "everytime"; // the film we write a note for, then open
const NOTE = "Recommended by Marco.";
const SEED = {
  // Notes already there when the video starts, so the Watchlist looks lived-in.
  "turtles-can-fly": "Marco says it's heartbreaking.",
  "the-taste-of-tea": "Saw a clip on YouTube and loved the colours.",
  "love-letter": "For the next movie night.",
};
const SEARCH = "marco";
const LOGO = readFileSync(join(ROOT, "icons", "icon.svg"), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/* ------------------------------------------------------------------ setup */

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const routes = {};
const posters = {};
for (const slug of ["who-killed-captain-alex", "cria", "a-ghost-story-2017"]) {
  const src = await posterFor(slug);
  if (src) posters[slug] = src;
}
routes[WATCHLIST] = await buildPage(WATCHLIST, { posters });
routes[`https://letterboxd.com/film/${FILM}/`] = await buildPage(`https://letterboxd.com/film/${FILM}/`);

const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true });
await browser.installExtension(ROOT);
const page = await browser.newPage();
await page.setViewport(VIEW);
await page.setRequestInterception(true);
page.on("request", (req) => {
  const body = routes[req.url().split("#")[0]];
  if (body) return req.respond({ status: 200, contentType: "text/html; charset=utf-8", body });
  if (req.url().startsWith("https://letterboxd.com/")) return req.abort();
  return req.continue();
});

/** Styles and elements drawn over the page: cursor, captions, cards. */
const OVERLAY_CSS = `
  #promo { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: var(--font-stack-graphik, sans-serif); }
  #promo * { box-sizing: border-box; }
  #promo-cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; will-change: transform; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
  .promo-ripple { position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,.9); animation: promo-ripple .45s cubic-bezier(.19,1,.22,1) forwards; }
  @keyframes promo-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
  #promo-caption { position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%); }
  .promo-caption { padding: 12px 22px 13px; border-radius: 999px; background: rgba(20,24,28,.88); color: #fff;
    font-size: 22px; font-weight: 600; letter-spacing: .005em; white-space: nowrap;
    box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 10px 30px rgba(0,0,0,.45);
    animation: promo-cap-in .5s cubic-bezier(.19,1,.22,1) both; }
  .promo-caption b { color: #40bcf4; font-weight: 600; }
  @keyframes promo-cap-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  #promo-fade { position: absolute; inset: 0; background: #14181c; opacity: 0; }
  .promo-card { position: absolute; inset: 0; background: #14181c; display: grid; place-items: center; color: #fff; }
  .promo-card.-out { animation: promo-out .45s ease-in forwards; }
  @keyframes promo-out { to { opacity: 0; } }
  .promo-lockup { display: grid; justify-items: center; gap: 14px; text-align: center; }
  .promo-lockup svg { width: 132px; height: 132px; animation: promo-pop .7s cubic-bezier(.19,1,.22,1) both; }
  .promo-lockup h1 { margin: 6px 0 0; font-size: 64px; font-weight: 700; letter-spacing: -.01em; animation: promo-rise .7s .12s cubic-bezier(.19,1,.22,1) both; }
  .promo-lockup p { margin: 0; color: #9ab; font-size: 26px; animation: promo-rise .7s .24s cubic-bezier(.19,1,.22,1) both; }
  .promo-lockup .promo-cta { margin-top: 14px; color: #40bcf4; font-size: 22px; font-weight: 600; animation-delay: .36s; }
  .promo-lockup small { margin-top: 18px; color: #567; font-size: 14px; animation: promo-rise .7s .48s cubic-bezier(.19,1,.22,1) both; }
  @keyframes promo-pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
  @keyframes promo-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  .promo-sync { display: grid; justify-items: center; gap: 26px; }
  .promo-sync h2 { margin: 0; font-size: 40px; font-weight: 700; animation: promo-rise .6s cubic-bezier(.19,1,.22,1) both; }
  .promo-sync h2 b { color: #40bcf4; font-weight: 700; }
  .promo-devices { position: relative; display: flex; gap: 150px; align-items: end; }
  .promo-device { width: 470px; display: grid; justify-items: center; gap: 10px; color: #789; font-size: 16px; letter-spacing: .08em; text-transform: uppercase;
    animation: promo-rise .7s cubic-bezier(.19,1,.22,1) both; }
  .promo-device:nth-child(3) { animation-delay: .12s; }
  .promo-screen { position: relative; width: 400px; height: 257px; border-radius: 10px; border: 10px solid #2c3440; background: #14181c; overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,.5); }
  .promo-screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
  .promo-screen .after { opacity: 0; animation: promo-in .35s 1.05s ease-out forwards; }
  @keyframes promo-in { to { opacity: 1; } }
  .promo-base { width: 470px; height: 14px; margin-top: -10px; border-radius: 0 0 14px 14px; background: #2c3440; }
  .promo-stand { width: 90px; height: 46px; margin-top: -10px; background: linear-gradient(#2c3440, #232a32); clip-path: polygon(25% 0, 75% 0, 100% 100%, 0 100%); }
  .promo-arc, .promo-arcbox { position: absolute; left: 50%; top: 40px; width: 230px; height: 120px; margin-left: -115px; overflow: visible; }
  .promo-arc path { fill: none; stroke: #456; stroke-width: 3; stroke-dasharray: 2 9; stroke-linecap: round; }
  .promo-dot { position: absolute; left: 0; top: 0; width: 12px; height: 12px; border-radius: 50%; background: #40bcf4;
    box-shadow: 0 0 12px rgba(64,188,244,.8); offset-path: path("M 0 110 C 60 -20, 170 -20, 230 110"); offset-rotate: 0deg; animation: promo-travel .9s .25s cubic-bezier(.65,0,.35,1) both; }
  @keyframes promo-travel { from { offset-distance: 0%; } to { offset-distance: 100%; } }
  .promo-sync-icon { position: absolute; left: 50%; top: -8px; width: 54px; height: 54px; margin-left: -27px; border-radius: 50%;
    background: #2c3440; display: grid; place-items: center; animation: promo-pop .6s .1s cubic-bezier(.19,1,.22,1) both; }
  .promo-sync-icon svg { width: 30px; height: 30px; animation: promo-spin 1.2s .2s cubic-bezier(.65,0,.35,1) both; }
  @keyframes promo-spin { to { transform: rotate(360deg); } }
  .promo-badge-arrive { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: #40bcf4;
    box-shadow: 0 0 0 0 rgba(64,188,244,.7); opacity: 0; animation: promo-arrive .6s 1.05s cubic-bezier(.19,1,.22,1) forwards; }
  @keyframes promo-arrive { 0% { opacity: 1; transform: scale(.3); box-shadow: 0 0 0 0 rgba(64,188,244,.7); }
    60% { transform: scale(1.35); } 100% { opacity: 1; transform: none; box-shadow: 0 0 0 16px rgba(64,188,244,0); } }
`;

const CURSOR_SVG = `<svg viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg"><path d="M4 2.5v19.2l5.2-4.9 3.3 7.4 3.4-1.5-3.3-7.3h7.2z" fill="#fff" stroke="#14181c" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const SYNC_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#40bcf4" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6"/><path d="M17.7 2.8v3.8h-3.8M6.3 21.2v-3.8h3.8"/></svg>`;

/** Adds the overlay to the current page (again after every navigation). */
async function setupPage({ scrollTo }) {
  await page.waitForSelector(".whylisted-badge");
  await page.waitForFunction(() => [...document.querySelectorAll(".film-poster img")].every((i) => i.complete), { timeout: 30000 });
  await page.addStyleTag({
    content:
      OVERLAY_CSS +
      // Nobody's name or avatar in the video; the heading reads as it does on your own Watchlist.
      ".profile-mini-person { visibility: hidden; } .whylisted-badge:focus-visible { outline: none; }",
  });
  await page.evaluate(
    (cursorSvg, scrollSelector) => {
      for (const s of document.querySelectorAll(".replace-if-you[data-replacement]")) s.textContent = s.dataset.replacement;
      const root = document.createElement("div");
      root.id = "promo";
      root.innerHTML = `<div id="promo-caption"></div><div id="promo-fade"></div><div id="promo-cursor">${cursorSvg}</div>`;
      document.documentElement.append(root);
      const target = scrollSelector && document.querySelector(scrollSelector);
      if (target) window.scrollTo(0, target.getBoundingClientRect().top + scrollY - 70);
    },
    CURSOR_SVG,
    scrollTo
  );
  await sleep(500);
}

/** Centre of an element, in viewport coordinates. */
const centre = (selector) =>
  page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

/* ---------------------------------------------------------- frame engine */

let frame = 0;
let vt = 0; // virtual time, ms
let cursor = { x: -60, y: -60 };
let mouseAt = null;

/** Freezes every CSS animation/transition and moves it to the current virtual time, then captures a frame. */
async function capture() {
  await page.evaluate(
    (vt, x, y) => {
      for (const a of document.getAnimations()) {
        if (a.__promoStart === undefined) {
          a.__promoStart = vt;
          a.pause();
        }
        a.currentTime = Math.max(0, vt - a.__promoStart);
      }
      const c = document.getElementById("promo-cursor");
      if (c) c.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    },
    vt,
    cursor.x,
    cursor.y
  );
  const buf = await page.screenshot({ type: "jpeg", quality: 95 });
  writeFileSync(join(FRAMES, `frame_${String(frame).padStart(5, "0")}.jpg`), buf);
  frame++;
  vt += 1000 / FPS;
}

/**
 * Runs a scene for `seconds`. `steps` are [time, action] pairs fired once when their time is
 * reached; `path` is a list of cursor waypoints { t, x, y } eased between.
 */
async function scene(seconds, { steps = [], path = [] } = {}) {
  const pending = [...steps].sort((a, b) => a[0] - b[0]);
  const frames = Math.round(seconds * FPS);
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    if (path.length) {
      let p = path[0];
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        if (t >= a.t && t <= b.t) {
          const k = ease((t - a.t) / (b.t - a.t));
          p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
          break;
        }
        if (t > b.t) p = b;
      }
      cursor = { x: p.x, y: p.y };
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (key !== mouseAt) {
        await page.mouse.move(p.x, p.y);
        mouseAt = key;
      }
    }
    while (pending.length && pending[0][0] <= t + 1e-6) await pending.shift()[1]();
    await capture();
  }
}

async function click() {
  await page.evaluate((x, y) => {
    const r = document.createElement("div");
    r.className = "promo-ripple";
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.getElementById("promo").append(r);
  }, cursor.x, cursor.y);
  await page.mouse.click(cursor.x, cursor.y);
}

/** Types `text` spread over [from, to] seconds: returns steps for scene(). */
function typing(text, from, to) {
  const steps = [];
  const per = (to - from) / text.length;
  for (let i = 0; i < text.length; i++) steps.push([from + i * per, () => page.keyboard.type(text[i])]);
  return steps;
}

const caption = (html) =>
  page.evaluate((html) => {
    const box = document.getElementById("promo-caption");
    box.innerHTML = html ? `<div class="promo-caption">${html}</div>` : "";
  }, html);

const fade = (opacity, ms) =>
  page.evaluate(
    (opacity, ms) => {
      const el = document.getElementById("promo-fade");
      el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity }], { duration: ms, fill: "forwards" });
    },
    opacity,
    ms
  );

const card = (html, id) =>
  page.evaluate(
    (html, id) => {
      const el = document.createElement("div");
      el.className = "promo-card";
      el.id = id;
      el.innerHTML = html;
      document.getElementById("promo").insertBefore(el, document.getElementById("promo-cursor"));
    },
    html,
    id
  );

const hideCard = (id) => page.evaluate((id) => document.getElementById(id)?.classList.add("-out"), id);

async function addNoteQuietly(slug, text) {
  const host = `.whylisted-host:has([data-item-slug="${slug}"])`;
  await page.hover(`${host} .film-poster`);
  await sleep(200);
  await page.click(`${host} .whylisted-badge`);
  await page.waitForSelector(".whylisted-pop.-open");
  await page.keyboard.type(text);
  await page.keyboard.down("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Control");
  await sleep(400);
}

/** A screenshot of the top of the grid, for the sync illustration. */
async function gridThumb() {
  await page.evaluate(() => (document.getElementById("promo-cursor").style.visibility = "hidden"));
  const clip = await page.$eval(".poster-grid", (g) => {
    const r = g.getBoundingClientRect();
    return { x: r.left + scrollX - 10, y: r.top + scrollY - 10, width: 640, height: 400 };
  });
  const buf = await page.screenshot({ type: "jpeg", quality: 90, clip });
  await page.evaluate(() => (document.getElementById("promo-cursor").style.visibility = ""));
  // Puppeteer returns a Uint8Array, whose toString() isn't base64: wrap it in a Buffer first.
  return { src: `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`, clip };
}

/* ------------------------------------------------------------- the video */

const filmHost = `.whylisted-host:has([data-item-slug="${FILM}"])`;

await page.goto(WATCHLIST, { waitUntil: "load" });
await setupPage({ scrollTo: "#content-nav" });
for (const [slug, text] of Object.entries(SEED)) await addNoteQuietly(slug, text);
await page.mouse.move(5, 5);
await page.evaluate(() => document.activeElement?.blur());
await sleep(500);
const before = await gridThumb();

// 1. Intro (0–2 s)
await card(
  `<div class="promo-lockup">${LOGO}<h1>Whylisted</h1><p>Remember why it's on your watchlist.</p></div>`,
  "promo-intro"
);
await scene(1.3);
await hideCard("promo-intro");
await scene(0.45);

// 2. Add a note from the Watchlist (≈6 s)
{
  const poster = await centre(`${filmHost} .film-poster`);
  const badge = await page.$eval(`${filmHost} .whylisted-badge`, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await caption("Add a note to any film in your <b>Watchlist</b>");
  const start = { x: VIEW.width * 0.55, y: VIEW.height * 0.72 };
  const typed = typing(NOTE, 1.75, 3.15);
  // Save button position is only known once the editor is open.
  let save = null;
  await scene(4.0, {
    path: [
      { t: 0, ...start },
      { t: 0.7, ...poster },
      { t: 1.15, ...badge },
    ],
    steps: [
      [1.25, click],
      [1.6, async () => (save = await centre(".whylisted-pop .-primary"))],
      ...typed,
    ],
  });
  await scene(1.0, { path: [{ t: 0, ...badge }, { t: 0.5, ...save }], steps: [[0.65, click]] });
  // The new badge pops; hover it to preview the note.
  await scene(1.4, { path: [{ t: 0, ...save }, { t: 0.45, ...badge }] });
}
const after = await gridThumb();
const badgeInThumb = await page.$eval(
  `${filmHost} .whylisted-badge`,
  (el, clip) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + scrollX + r.width / 2 - clip.x) / clip.width, y: (r.top + scrollY + r.height / 2 - clip.y) / clip.height };
  },
  after.clip
);

// 3. The same note on the film's page (≈3.6 s)
await fade(1, 250);
await scene(0.3);
await page.goto(`https://letterboxd.com/film/${FILM}/`, { waitUntil: "load" });
await setupPage({ scrollTo: "#js-poster-col" });
mouseAt = null;
await page.evaluate(() => {
  const el = document.getElementById("promo-fade");
  el.style.opacity = "1";
});
await fade(0, 300);
await caption("…and see it again on the <b>film's page</b>");
{
  const cover = await centre("#js-poster-col .film-poster");
  const badge = await centre("#js-poster-col .whylisted-badge");
  await scene(2.9, {
    path: [
      { t: 0, x: cover.x + 260, y: cover.y + 120 },
      { t: 0.7, ...cover },
      { t: 1.05, ...badge },
    ],
    steps: [[1.75, click]],
  });
}

// 4. Search and filter by note (≈4 s)
await fade(1, 250);
await scene(0.3);
await page.goto(WATCHLIST, { waitUntil: "load" });
await setupPage({ scrollTo: null });
mouseAt = null;
await page.evaluate(() => (document.getElementById("promo-fade").style.opacity = "1"));
await fade(0, 300);
await caption("<b>Search and filter</b> your Watchlist by note");
{
  const label = await centre(".whylisted-notes-label");
  await scene(2.4, {
    path: [
      { t: 0, x: label.x - 220, y: label.y + 260 },
      { t: 0.6, ...label },
    ],
    steps: [
      [0.7, click],
      ...typing(SEARCH, 1.05, 1.6),
    ],
  });
  // Clear the search, then show only films with a note. The label gets shorter when the search is
  // cleared and the right-aligned menu shifts, so measure the item afterwards.
  await page.$eval(".whylisted-menu-input", (i) => {
    i.value = "";
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(150);
  const withNote = await page.$$eval(".whylisted-menu-item", (els) => {
    const r = els[1].getBoundingClientRect();
    return { x: r.left + 60, y: r.top + r.height / 2 };
  });
  await scene(1.4, { path: [{ t: 0, ...cursor }, { t: 0.45, ...withNote }], steps: [[0.55, click]] });
}

// 5. Sync (≈2.6 s)
await card(
  `<div class="promo-sync">
     <h2>Synced with your <b>Firefox account</b></h2>
     <div class="promo-devices">
       <div class="promo-device"><div class="promo-screen"><img src="${after.src}"></div><div class="promo-base"></div>Laptop</div>
       <div class="promo-sync-icon">${SYNC_SVG}</div>
       <div class="promo-device"><div class="promo-screen"><img src="${before.src}"><img class="after" src="${after.src}">
         <div class="promo-badge-arrive" style="left:${(badgeInThumb.x * 100).toFixed(2)}%;top:${(badgeInThumb.y * 100).toFixed(2)}%"></div></div>
         <div class="promo-stand"></div>Desktop</div>
       <svg class="promo-arc" viewBox="0 0 230 120"><path d="M 0 110 C 60 -20, 170 -20, 230 110"/></svg>
       <div class="promo-arcbox"><div class="promo-dot"></div></div>
     </div>
   </div>`,
  "promo-sync"
);
await caption("");
cursor = { x: -60, y: -60 };
await page.waitForFunction(() => [...document.querySelectorAll(".promo-screen img")].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 });
await scene(2.6);

// 6. Outro (≈1.8 s)
await card(
  `<div class="promo-lockup">${LOGO}<h1>Whylisted</h1><p>Remember why it's on your watchlist.</p>
     <p class="promo-cta">Free on Firefox Add-ons</p><small>Unofficial · not affiliated with Letterboxd</small></div>`,
  "promo-outro"
);
await scene(1.7);

await browser.close();
console.log(`${frame} frames (${(frame / FPS).toFixed(1)} s) in promo/frames`);

/* --------------------------------------------------------------- encode */

/** A tiny HTML player for the frames, to preview the video without encoding it. */
function preview() {
  const count = readdirSync(FRAMES).filter((f) => f.endsWith(".jpg")).length;
  writeFileSync(
    join(OUT, "preview.html"),
    `<!doctype html><meta charset="utf-8"><title>Whylisted promo preview</title>
<style>html,body{margin:0;height:100%;background:#000;display:grid;place-items:center}img{max-width:100vw;max-height:100vh}
p{position:fixed;bottom:8px;left:0;right:0;text-align:center;color:#678;font:13px system-ui}</style>
<img id="v" alt=""><p>Click to replay · ${count} frames at ${FPS} fps</p>
<script>
const n = ${count}, fps = ${FPS}, v = document.getElementById("v");
const src = (i) => "frames/frame_" + String(i).padStart(5, "0") + ".jpg";
const cache = []; for (let i = 0; i < n; i++) { cache[i] = new Image(); cache[i].src = src(i); }
let t0 = 0;
function play() { t0 = performance.now(); requestAnimationFrame(step); }
function step(now) { const i = Math.floor((now - t0) / 1000 * fps); if (i < n) { v.src = src(i); requestAnimationFrame(step); } }
Promise.all(cache.map((im) => im.decode().catch(() => {}))).then(play);
document.onclick = play;
</script>`
  );
  console.log("wrote promo/preview.html");
}

/** H.264 MP4 for Reddit and co. (needs ffmpeg). */
function mp4() {
  // ffmpeg from FFMPEG, PATH, or a winget install whose PATH entry isn't active in this shell yet.
  const wingetDir = join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  const fromWinget = existsSync(wingetDir)
    ? readdirSync(wingetDir)
        .filter((d) => d.startsWith("Gyan.FFmpeg"))
        .flatMap((d) => readdirSync(join(wingetDir, d)).map((sub) => join(wingetDir, d, sub, "bin", "ffmpeg.exe")))
        .find(existsSync)
    : null;
  const ffmpeg = process.env.FFMPEG || (spawnSync("ffmpeg", ["-version"]).status === 0 ? "ffmpeg" : fromWinget || "ffmpeg");
  const r = spawnSync(
    ffmpeg,
    ["-y", "-framerate", String(FPS), "-i", join(FRAMES, "frame_%05d.jpg"),
     // JPEG frames are full-range; convert to the standard (limited) range players and Reddit expect.
     "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p",
     "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high",
     "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
     "-movflags", "+faststart",
     join(OUT, "whylisted-promo.mp4")],
    { stdio: "inherit" }
  );
  if (r.error || r.status !== 0) console.error("ffmpeg failed or is not installed; the frames are in promo/frames.");
  else console.log("wrote promo/whylisted-promo.mp4");
}

preview();
if (process.argv.includes("--mp4")) mp4();
