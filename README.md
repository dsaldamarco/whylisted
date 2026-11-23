<p align="center">
  <img src="docs/logo.png" width="128" height="128" alt="Whylisted logo: a film poster with a blue note badge in its corner">
</p>

<h1 align="center">Whylisted</h1>

<p align="center">
  <strong>Remember why it's on your watchlist.</strong><br>
  Private notes for your Letterboxd Watchlist, right on the poster. A Firefox add-on.
</p>

<p align="center">
  <img src="docs/screenshots/watchlist.png" alt="A Letterboxd Watchlist with small blue note badges on some posters; hovering one shows the note 'Watch this before the sequel.'">
</p>

---

## The problem

Saving a film to your Letterboxd Watchlist takes one click. Remembering *why* you saved it is harder.

You add films for all kinds of reasons:

- a friend told you, twice, that you *have* to see it;
- you read a review that stuck with you;
- you want to see it before the sequel comes out;
- it's part of a director's filmography you're working through;
- you saw thirty seconds of it and loved how it looked.

The reason is obvious when you add the film. Three months and two hundred films later it's gone. You open the Watchlist to pick something for tonight and see a wall of posters, many of which you can't place any more. *Who recommended this? Why did I want to see it?*

Letterboxd doesn't offer a place to write that down. **Whylisted adds one.**

## What it does

Whylisted lets you attach a short private note to any film, and shows it where you need it: on the poster.

<p align="center">
  <img src="docs/screenshots/editor.png" alt="The note editor open beside a poster, with the text 'Apparently one of the best sci-fi films ever made. Ask Giulia for her copy.'">
</p>

- **See at a glance which films have a note.** They carry a small blue badge in the top-right corner of the poster, set into a cut-out ring the way Letterboxd shows avatars on attributed posters.
- **Read it without clicking.** Hover the badge and the note appears in a Letterboxd-style tooltip.
- **Add one in a second.** Hover any poster, click the **+** that appears in the same corner and type. Nothing else on the page moves.
- **Edit or delete it at any time.** The editor shows when the note was added or last edited.
- **Find it on the film's page too.** The same note sits on the cover when you open the film. You can write it there too, even before the film is on your Watchlist.

<p align="center">
  <img src="docs/screenshots/film-page.png" alt="A Letterboxd film page with the note editor open beside the film's cover, showing 'Recommended by Marco.'">
</p>

### Designed to look like Letterboxd

Whylisted is meant to look like a feature Letterboxd shipped itself. The editor uses Letterboxd's own dialog colours, its private-note text field, its typography, its green **Save** button and its easing curves. It reads those values from the site's CSS variables, so if Letterboxd changes its look, Whylisted follows.

| | |
|---|---|
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> | Save |
| <kbd>Esc</kbd> | Close without saving |
| Click outside | Save and close, so a note is never lost by accident |
| **Delete** | Asks once ("Delete?"), then removes the note |
| Empty note | Saving an empty note removes it |

The editor keeps keyboard focus inside while it's open, follows `prefers-reduced-motion`, and on narrow screens becomes a full-width panel under the poster.

## Notes follow the film, not the grid

Each note is stored against **Letterboxd's own film identifier** (for example `film:1041139`), which Letterboxd puts on every poster. It is never stored against a position in the grid.

So a note stays with its film when you:

- re-sort or filter the Watchlist, or page through it;
- remove a film and add it back later (the note will be waiting);
- reload the page or restart Firefox;
- open the film's own page (`/film/<slug>/`) or another Watchlist page, or have it open in another tab (tabs stay in sync).

The film's slug (`/film/la-gradiva/`) is kept as a fallback for the rare poster without an id. If a uid turns up later for a note saved by slug, the note is moved to the uid automatically.

## Privacy

- Notes are stored **only in your browser** (`browser.storage.local`). Nothing is sent anywhere, and there is no account, server or tracking.
- Whylisted never asks for your Letterboxd credentials and never reads, changes or submits anything on your Letterboxd account.
- Its only permission is `storage`, and it only runs on `letterboxd.com`.

## Install

**From Firefox Add-ons:** coming soon.

**From source (development):** requires Firefox 128 or newer. Node.js 18+ is only needed for the tooling.

```bash
git clone https://github.com/dsaldamarco/whylisted.git
cd whylisted
npm install
npm start          # opens a fresh Firefox profile with Whylisted loaded
```

Or load it by hand, without Node:

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in this folder.
3. Sign in to Letterboxd and open your Watchlist (`letterboxd.com/<you>/watchlist/`).

Temporary add-ons are removed when Firefox closes. Your notes are kept for the next time you load it.

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Run Firefox with the extension loaded (`web-ext run`) |
| `npm run lint` | Validate the extension with Mozilla's linter |
| `npm run build` | Package a `.zip` into `web-ext-artifacts/` |
| `npm run test:e2e` | End-to-end test in real Firefox (see below) |
| `npm run screenshots` | Regenerate the screenshots in this README |
| `npm run icons` | Render `icons/icon.svg` to `docs/logo.png` |
| `npm run sign` | Submit a new version to addons.mozilla.org (needs API keys, see below) |

### Tests

`tests/e2e.mjs` installs the extension into real Firefox (driven by WebDriver BiDi through `puppeteer-core`) and checks the whole lifecycle:

- create, hover preview, edit, cancel and delete;
- notes surviving a reload, a re-sort, grid items re-rendered in place, and a full browser restart on the same profile;
- notes shared between the Watchlist and film pages, with only the film's own cover getting a badge (not the "similar films" row);
- the phone-width layout;
- nothing injected on other pages.

Letterboxd shows automated browsers a bot check, so the test does not drive the live site. It fetches the real page HTML with a plain request, strips the scripts, rewrites the posters into the shape they take after Letterboxd's React hydration, and serves the result at the real `letterboxd.com` URL. Class names, data attributes, stylesheets, fonts and poster images are Letterboxd's own.

Set `FIREFOX_PATH` if Firefox isn't in a standard location, and `HEADFUL=1` to watch it run.

## How it works

```
manifest.json            MV3 manifest: one content script bundle + one stylesheet, "storage" permission
icons/icon.svg           the add-on icon
src/
  namespace.js           shared `Whylisted` namespace (nothing leaks into the page)
  film.js                reads the film id, slug, title and year from a poster
  store.js               notes in browser.storage.local; cache, migration, cross-tab sync
  ui/icons.js            inline SVG glyphs
  ui/tooltip.js          Letterboxd-style ("twipsy") tooltip for hints and previews
  ui/editor.js           the note popover: layout, keyboard, save/cancel/delete
  ui/badge.js            the poster badge and its states
  main.js                finds posters (Watchlist grid, film-page cover) and keeps badges in sync
  whylisted.css          all styles, built on Letterboxd's own CSS custom properties
tests/                   end-to-end test in Firefox, and the fixture it uses
scripts/                 icon rendering, README screenshots
docs/                    logo and screenshots for this README
```

**Integration.** Letterboxd renders posters as server HTML wrapping React "islands" (`LazyPoster`): `li.griditem` in a Watchlist, `#js-poster-col > section.poster-list.-single` for the cover on a film page. Whylisted only ever appends its badge to that server-rendered wrapper, never inside React's tree, so Letterboxd's re-renders can't remove it and won't trip over it. The cut-out ring is pure CSS (a `mask` on the poster), so React's DOM is never touched.

**Dynamic pages.** A single `MutationObserver`, batched to one scan per animation frame, picks up posters as they are added, hydrated, re-sorted or swapped in place. Each poster's wrapper remembers which film its badge belongs to. If Letterboxd reuses it for another film, the badge is rebuilt for the new one.

**Styling.** Every class is prefixed `whylisted-`. Colours, fonts and easing come from Letterboxd's CSS custom properties (`--theme-*`, `--font-stack-graphik`, `--timing-function-ease-out-expo`…), with fallbacks set to today's values. The editor opts into Letterboxd's `data-theme="dialog"` palette.

### Storage format

One key per film, designed so export, import and sync can be added later without a migration:

```json
{
  "schemaVersion": 1,
  "note:film:1041139": {
    "film": "film:1041139",
    "slug": "la-gradiva",
    "title": "La Gradiva",
    "year": "2026",
    "text": "Recommended by Marco.",
    "createdAt": "2026-11-23T10:12:00.000Z",
    "updatedAt": "2026-11-23T10:12:00.000Z"
  }
}
```

## Limitations

- **Watchlists and film pages only.** Whylisted runs on `letterboxd.com/<user>/watchlist/…` and on the cover of `letterboxd.com/film/<slug>/…`. It also runs on other people's Watchlists: your notes are about films, so you'll see them on a friend's Watchlist too. Lists, diary and other poster grids aren't covered yet.
- **One browser.** Notes live in this Firefox profile and don't sync between devices yet. Uninstalling the add-on deletes them.
- **Depends on Letterboxd's markup.** Whylisted relies on the film ids Letterboxd puts on posters (`data-postered-identifier`, `data-production-uid`). If those change it fails quietly: no badges, no errors, the page keeps working. An update would then be needed.
- **Mobile site.** Built for desktop Firefox. Touch screens get an always-visible "+", but Letterboxd's mobile layouts haven't been tested much.

## Ideas for later

- Export / import notes (JSON, maybe CSV for spreadsheets)
- Search and filter the Watchlist by note
- Tags ("movie night", "with Marco", "director project")
- Sync across devices via `storage.sync` or a file
- Notes on lists, diary entries and other poster grids

## Contributing

Issues and pull requests are welcome. Please keep the spirit of the project: one small feature, done carefully, that looks like it belongs on Letterboxd.

## Disclaimer

Whylisted is an independent, unofficial project. It is not affiliated with, endorsed by or sponsored by Letterboxd Limited. "Letterboxd" and the three-dot logo are trademarks of Letterboxd Limited, used here only to show what the add-on works with. Screenshots show Letterboxd's interface and poster artwork from a public Watchlist, for illustration only.

## License

Code: [MIT](LICENSE).
