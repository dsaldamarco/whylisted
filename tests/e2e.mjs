/**
 * End-to-end test in real Firefox.
 *
 *   npm run test:e2e
 *
 * Loads the extension into Firefox via WebDriver BiDi, opens a Letterboxd
 * Watchlist and checks the whole note lifecycle: create, persist across
 * reloads, follow the film when the order changes or nodes are reused, edit,
 * cancel, delete, and survive a full browser restart (same profile).
 *
 * Pages are served at their real letterboxd.com URLs from a fixture built
 * from the live page's HTML (see fixture.mjs), because Letterboxd shows
 * automated browsers a bot check.
 *
 * Env:
 *   FIREFOX_PATH  Firefox binary (defaults to the standard Windows/macOS/Linux locations)
 *   WATCHLIST     Watchlist to test against (default: a large public one)
 *   SHOTS         Directory for screenshots (default: tests/screenshots)
 *   HEADFUL=1     Show the browser
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { buildFixtures, buildPage } from "./fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WATCHLIST = process.env.WATCHLIST || "https://letterboxd.com/dave/watchlist/";
const SORTED = WATCHLIST.replace(/\/?$/, "/") + "by/name/";
const SHOTS = process.env.SHOTS || join(ROOT, "tests", "screenshots");
const FIREFOX =
  process.env.FIREFOX_PATH ||
  [
    "C:/Program Files/Mozilla Firefox/firefox.exe",
    "/Applications/Firefox.app/Contents/MacOS/firefox",
    "/usr/bin/firefox",
  ].find(existsSync);

const OTHER_PAGE = "https://letterboxd.com/films/popular/";

const profile = mkdtempSync(join(tmpdir(), "whylisted-profile-"));
mkdirSync(SHOTS, { recursive: true });

const fixtures = await buildFixtures(WATCHLIST);
const ROUTES = {
  [WATCHLIST]: fixtures.watchlist,
  [SORTED]: fixtures.sorted,
  [OTHER_PAGE]: fixtures.watchlist, // same posters, but not a Watchlist URL
};

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const browser = await puppeteer.launch({
    browser: "firefox",
    executablePath: FIREFOX,
    headless: !process.env.HEADFUL,
    userDataDir: profile,
    extraPrefsFirefox: {
      // Temporary add-ons are uninstalled when Firefox quits; keep their
      // storage so the restart test reflects a normally installed add-on.
      "extensions.webextensions.keepStorageOnUninstall": true,
      "extensions.webextensions.keepUuidOnUninstall": true,
    },
  });
  await browser.installExtension(ROOT);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url().split("#")[0];
    const body = ROUTES[url];
    if (body) return req.respond({ status: 200, contentType: "text/html; charset=utf-8", body });
    // Any other letterboxd.com request (there should be none without scripts) is blocked.
    if (url.startsWith("https://letterboxd.com/")) return req.abort();
    return req.continue();
  });
  return { browser, page };
}

async function open(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".whylisted-badge", { timeout: 30000 });
  await sleep(800);
}

/** Film uids on the page, in grid order. */
const uids = (page) =>
  page.$$eval(".whylisted-host", (els) =>
    els.map((el) => el.querySelector("[data-production-uid]")?.getAttribute("data-production-uid"))
  );

/** uid → note label for every badge showing a note. */
const notesOnPage = (page) =>
  page.$$eval(".whylisted-host.whylisted-has-note", (els) =>
    Object.fromEntries(
      els.map((el) => [
        el.querySelector("[data-production-uid]")?.getAttribute("data-production-uid"),
        el.querySelector(".whylisted-badge").getAttribute("aria-label"),
      ])
    )
  );

/** Reads / writes Whylisted's storage.sync data straight from the profile (Firefox must be closed). */
const EXT_ID = "whylisted@whylisted.app";
function readSync() {
  const db = new DatabaseSync(join(profile, "storage-sync-v2.sqlite"));
  const row = db.prepare("SELECT data FROM storage_sync_data WHERE ext_id = ?").get(EXT_ID);
  db.close();
  return row?.data ? JSON.parse(row.data) : {};
}
function writeSync(data) {
  const db = new DatabaseSync(join(profile, "storage-sync-v2.sqlite"));
  db.prepare("UPDATE storage_sync_data SET data = ?, sync_change_counter = 0 WHERE ext_id = ?").run(JSON.stringify(data), EXT_ID);
  db.close();
}

const hostFor = (uid) => `.whylisted-host:has([data-production-uid="${uid}"])`;

async function openEditor(page, uid) {
  await page.hover(`${hostFor(uid)} .film-poster`);
  await sleep(250);
  await page.click(`${hostFor(uid)} .whylisted-badge`);
  await page.waitForSelector(".whylisted-pop.-open", { timeout: 5000 });
  await sleep(350);
}

async function writeNote(page, uid, text) {
  await openEditor(page, uid);
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type(text);
  await page.keyboard.down("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Control");
  await sleep(500);
}

let browser = null;
let page = null;
try {
  console.log(`Firefox: ${FIREFOX}\nWatchlist: ${WATCHLIST}\n`);
  ({ browser, page } = await launch());

  console.log("Injection");
  await open(page, WATCHLIST);
  const order = await uids(page);
  ok(order.length > 10 && order.every(Boolean), `badge attached to every poster (${order.length})`);
  ok((await page.$$(".whylisted-host.whylisted-has-note")).length === 0, "no notes on a fresh profile");
  await page.hover(`${hostFor(order[1])} .film-poster`);
  await sleep(500);
  await page.screenshot({ path: join(SHOTS, "1-hover-add.png") });

  console.log("Create");
  const [A, B] = [order[1], order[6]];
  await openEditor(page, A);
  await page.keyboard.type("Recommended by Marco.");
  await page.screenshot({ path: join(SHOTS, "2-editor-new.png") });
  await page.keyboard.down("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Control");
  await sleep(600);
  let notes = await notesOnPage(page);
  ok(notes[A]?.includes("Recommended by Marco."), "note saved with Ctrl+Enter and shown on the right poster");
  ok(Object.keys(notes).length === 1, "only that poster shows a note");

  // Click-outside saves.
  await openEditor(page, B);
  await page.keyboard.type("Watch this before seeing the sequel.");
  await page.mouse.click(20, 500);
  await sleep(600);
  notes = await notesOnPage(page);
  ok(notes[B]?.includes("before seeing the sequel"), "clicking outside saves the note");
  await page.mouse.move(5, 5);
  await sleep(400);
  await page.screenshot({ path: join(SHOTS, "3-badges.png") });

  // Hover preview.
  await page.hover(`${hostFor(A)} .whylisted-badge`);
  await sleep(500);
  const tip = await page.$eval(".whylisted-tip", (el) => ({ text: el.textContent, visible: el.classList.contains("-visible") }));
  ok(tip.visible && tip.text.includes("Recommended by Marco."), "hovering the badge previews the note");
  await page.screenshot({ path: join(SHOTS, "4-preview.png") });

  console.log("Persistence & identity");
  await open(page, WATCHLIST);
  notes = await notesOnPage(page);
  ok(notes[A] && notes[B] && Object.keys(notes).length === 2, "notes survive a reload, on the same films");

  await open(page, SORTED);
  const sortedOrder = await uids(page);
  notes = await notesOnPage(page);
  const misplaced = Object.keys(notes).filter((uid) => uid !== A && uid !== B);
  ok(misplaced.length === 0, "a re-sorted watchlist never shows a note on a different film");
  const present = [A, B].filter((u) => sortedOrder.includes(u));
  ok(present.every((u) => notes[u]), `films present after re-sorting keep their notes (${present.length} on this page)`);
  ok(sortedOrder.indexOf(A) !== order.indexOf(A) || !present.length, "grid order actually changed");

  // Letterboxd can re-render a grid in place: the same <li> now holds another film.
  await open(page, WATCHLIST);
  await page.evaluate((a) => {
    const hosts = [...document.querySelectorAll(".whylisted-host")];
    const ia = hosts.findIndex((h) => h.querySelector(`[data-production-uid="${a}"]`));
    const ib = ia === 0 ? 1 : 0;
    const pa = hosts[ia].querySelector(".react-component");
    const pb = hosts[ib].querySelector(".react-component");
    hosts[ia].prepend(pb);
    hosts[ib].prepend(pa);
  }, A);
  await sleep(500);
  const swapped = await page.$$eval(".whylisted-host.whylisted-has-note", (els) =>
    els.map((el) => el.querySelector("[data-production-uid]").getAttribute("data-production-uid"))
  );
  ok(swapped.includes(A) && swapped.includes(B) && swapped.length === 2, "notes follow films when grid items are reused in place");
  ok((await page.$$(".whylisted-badge")).length === (await page.$$(".whylisted-host")).length, "exactly one badge per poster after a re-render");

  console.log("Edit, cancel, delete");
  await open(page, WATCHLIST);
  await writeNote(page, A, "Recommended by Marco. Watch on a big screen.");
  notes = await notesOnPage(page);
  ok(notes[A]?.includes("big screen"), "editing replaces the note");

  await openEditor(page, A);
  const meta = await page.$eval(".whylisted-pop-meta", (el) => el.textContent);
  ok(/^(Added|Edited) \d{1,2} \w{3} \d{4}$/.test(meta), `editor shows note date ("${meta}")`);
  await page.screenshot({ path: join(SHOTS, "5-editor-existing.png") });
  await page.keyboard.type(" THIS SHOULD NOT BE SAVED");
  await page.keyboard.press("Escape");
  await sleep(400);
  notes = await notesOnPage(page);
  ok(!notes[A]?.includes("SHOULD NOT"), "Esc discards unsaved changes");
  ok(await page.$eval(".whylisted-pop", (el) => el.hidden), "Esc closes the editor");

  await openEditor(page, B);
  await page.click(".whylisted-pop .-destructive");
  await sleep(200);
  ok((await notesOnPage(page))[B], "first Delete click only asks for confirmation");
  await page.screenshot({ path: join(SHOTS, "6-delete-confirm.png") });
  await page.click(".whylisted-pop .-destructive");
  await sleep(600);
  notes = await notesOnPage(page);
  ok(!notes[B] && notes[A], "second click deletes just that note");

  // Saving blank text removes the note too.
  const C = order[3];
  await writeNote(page, C, "Temporary");
  await writeNote(page, C, " ");
  ok(!(await notesOnPage(page))[C], "saving an empty note deletes it");

  console.log("Film page");
  const slugOf = (uid) =>
    page.$eval(`${hostFor(uid)} [data-item-slug]`, (el) => el.getAttribute("data-item-slug"));
  const filmUrl = async (uid) => {
    const url = `https://letterboxd.com/film/${await slugOf(uid)}/`;
    ROUTES[url] ??= await buildPage(url);
    return url;
  };
  const urlA = await filmUrl(A);
  const urlB = await filmUrl(B);

  await open(page, urlA);
  ok((await page.$$(".film-poster")).length > 1, "film page has other posters too (similar films)");
  ok((await page.$$(".whylisted-badge")).length === 1, "only the film's own cover gets a badge");
  notes = await notesOnPage(page);
  ok(notes[A]?.includes("big screen"), "a note written in the Watchlist shows on the film's cover");
  ok(await page.$eval(hostFor(A), (el) => el.classList.contains("whylisted-large")), "cover uses the large badge");
  await page.mouse.move(5, 5);
  await sleep(400);
  await page.screenshot({ path: join(SHOTS, "8-film-page.png") });

  await writeNote(page, A, "Recommended by Marco. Watch on a big screen, with friends.");
  ok((await notesOnPage(page))[A]?.includes("with friends"), "the note can be edited from the film page");

  await open(page, urlB);
  ok(!(await notesOnPage(page))[B], "a film without a note shows no note on its cover");
  await openEditor(page, B);
  await page.screenshot({ path: join(SHOTS, "9-film-page-editor.png") });
  await page.keyboard.type("Part of the director's filmography project.");
  await page.keyboard.down("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Control");
  await sleep(600);
  ok((await notesOnPage(page))[B]?.includes("filmography"), "a note can be added from the film page");

  await open(page, WATCHLIST);
  notes = await notesOnPage(page);
  ok(notes[A]?.includes("with friends") && notes[B]?.includes("filmography"), "film-page notes show up in the Watchlist");

  console.log("Small screens");
  await page.setViewport({ width: 390, height: 844 });
  await open(page, WATCHLIST);
  await openEditor(page, A);
  const box = await page.$eval(".whylisted-pop", (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, vw: document.documentElement.clientWidth };
  });
  ok(box.left >= 15 && box.right <= box.vw - 15, "editor fits a phone-width viewport with gutters");
  await page.screenshot({ path: join(SHOTS, "7-mobile.png") });
  await page.keyboard.press("Escape");

  console.log("Browser restart & sync");
  await browser.close();

  // Firefox keeps storage.sync in this file; Firefox Sync uploads from and downloads into it.
  let synced = readSync();
  ok(synced[`n:${A}`]?.t.includes("with friends") && synced[`n:${B}`]?.t.includes("filmography"), "notes are written to Firefox Sync storage");
  ok(Object.keys(synced).filter((k) => k.startsWith("n:")).length === 2, "deleted notes are removed from Firefox Sync storage");

  // Simulate Firefox Sync bringing changes from another computer: one new note, one deletion.
  const D = order[10];
  const now = Date.now();
  delete synced[`n:${B}`];
  synced[`n:${D}`] = { t: "Added on my other computer.", s: "remote", n: "Remote", c: now, u: now };
  writeSync(synced);

  ({ browser, page } = await launch());
  await open(page, WATCHLIST);
  notes = await notesOnPage(page);
  ok(notes[A]?.includes("with friends"), "notes survive a browser restart");
  ok(notes[D]?.includes("other computer"), "a note synced from another device appears");
  ok(!notes[B], "a note deleted on another device disappears (no local copy brings it back)");
  ok(Object.keys(notes).length === 2, "no other notes appear");

  console.log("Sync storage full");
  // Each note of 2000 quotes is ~4 KB once JSON-escaped, so 28 of them exceed sync's ~100 KB quota.
  const all = await uids(page);
  for (const uid of all) {
    await openEditor(page, uid);
    await page.$eval(".whylisted-pop-text", (t) => {
      t.value = '"'.repeat(2000);
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.click(".whylisted-pop .-primary");
    await sleep(250);
  }
  await sleep(500);
  ok((await page.$$(".whylisted-host.whylisted-has-note")).length === all.length, "every note is saved even when sync storage is full");
  const metas = [];
  for (const uid of all.slice(-4)) {
    await openEditor(page, uid);
    metas.push(await page.$eval(".whylisted-pop-meta", (el) => el.textContent));
    await page.keyboard.press("Escape");
    await sleep(250);
  }
  const overflowUid = all.slice(-4)[metas.findIndex((m) => m.includes("This device only"))];
  ok(Boolean(overflowUid), `notes that don't fit say they're on this device only ("${metas.find((m) => m.includes("device")) ?? metas[0]}")`);

  // Deleting a few notes makes room: the local-only note moves into sync.
  for (const uid of all.slice(0, 6)) {
    await writeNote(page, uid, " ");
  }
  await sleep(800);
  if (overflowUid) {
    await openEditor(page, overflowUid);
    const meta = await page.$eval(".whylisted-pop-meta", (el) => el.textContent);
    ok(!meta.includes("device"), "once there is room, local-only notes are synced");
    await page.keyboard.press("Escape");
  }
  await browser.close();
  synced = readSync();
  ok(overflowUid && synced[`n:${overflowUid}`], "…and are written to Firefox Sync storage");
  ({ browser, page } = await launch());

  console.log("Other pages");
  await page.goto(OTHER_PAGE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1500);
  ok((await page.$$(".film-poster")).length > 10, "control page has posters");
  ok((await page.$$(".whylisted-badge")).length === 0, "nothing injected outside the Watchlist and film pages");

  await browser.close();
  browser = null;
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser?.close().catch(() => {});
  await sleep(1000);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    console.warn(`(could not remove temporary profile ${profile})`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
