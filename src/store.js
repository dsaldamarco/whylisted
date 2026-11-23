/**
 * Note storage, synced across devices through Firefox Sync.
 *
 * Notes live in `browser.storage.sync`. Firefox keeps that area on disk and,
 * when the user is signed in to Firefox with "Add-ons" ticked in their Sync
 * settings, copies it to every other desktop Firefox on the same account.
 * Signed out, it behaves exactly like local storage. Writes work offline and
 * are synced later. Firefox resolves conflicts per key (last writer wins).
 *
 *   storage.sync   "n:film:1041139": { t, s, n, y, c, u }       one compact item per film
 *   storage.local  "schemaVersion": 2
 *                  "note:film:1041139": { film, slug, title, year, text,
 *                                         createdAt, updatedAt, local: true }
 *
 * `storage.sync` is small (Firefox allows about 100 KB and 512 items per
 * add-on, so a few hundred notes). A note that does not fit is kept in
 * `storage.local` instead, marked `local: true`, and shown as "only on this
 * device". When space frees up (a note is deleted), local-only notes are moved
 * into sync, oldest first.
 *
 * Inside the extension a note always has the same shape:
 *   { film, slug, title, year, text, createdAt, updatedAt, local }
 * with ISO dates. The compact format exists only to save sync quota.
 *
 * Version 1 kept every note in `storage.local`. Those notes are moved to
 * sync the first time this version runs.
 */
(() => {
  "use strict";

  const SCHEMA_VERSION = 2;
  const SYNC_PREFIX = "n:";
  const LOCAL_PREFIX = "note:";
  /** Generous ceiling; a note is a reminder, not an essay. Also keeps one item well under sync's 8 KB per-item limit. */
  const MAX_LENGTH = 2000;

  const api = globalThis.browser ?? globalThis.chrome;
  const sync = api.storage.sync;
  const local = api.storage.local;

  /** film key → note, as stored in each area. */
  const synced = new Map();
  const localOnly = new Map();
  /** @type {Set<(key: string) => void>} */
  const listeners = new Set();
  let ready = null;

  /* ---------------------------------------------------------------- format */

  function toCompact(note) {
    return {
      t: note.text,
      s: note.slug ?? undefined,
      n: note.title || undefined,
      y: note.year ?? undefined,
      c: Date.parse(note.createdAt),
      u: Date.parse(note.updatedAt),
    };
  }

  function fromCompact(key, item) {
    if (!item || typeof item !== "object" || typeof item.t !== "string") return null;
    return {
      film: key,
      slug: item.s ?? null,
      title: item.n ?? "",
      year: item.y ?? null,
      text: item.t,
      createdAt: new Date(item.c || item.u || Date.now()).toISOString(),
      updatedAt: new Date(item.u || item.c || Date.now()).toISOString(),
      local: false,
    };
  }

  function isLocalNote(value) {
    return value && typeof value === "object" && typeof value.text === "string" && typeof value.film === "string";
  }

  /** The note to show for a key: whichever copy is newer. */
  function resolve(key) {
    const a = synced.get(key);
    const b = localOnly.get(key);
    if (a && b) return Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
    return a ?? b ?? null;
  }

  function emit(key) {
    for (const fn of listeners) {
      try {
        fn(key);
      } catch (err) {
        console.error("[Whylisted]", err);
      }
    }
  }

  /* ------------------------------------------------------------ low level */

  /** Writes a note to sync. Returns false (and logs) if it does not fit. */
  async function trySync(note) {
    try {
      await sync.set({ [SYNC_PREFIX + note.film]: toCompact(note) });
      return true;
    } catch (err) {
      console.warn("[Whylisted] Sync storage is full; keeping this note on this device only.", err?.message ?? err);
      return false;
    }
  }

  async function writeLocal(note) {
    const value = { ...note, local: true };
    localOnly.set(note.film, value);
    await local.set({ [LOCAL_PREFIX + note.film]: value });
    return value;
  }

  async function dropLocal(key) {
    if (!localOnly.delete(key)) return;
    await local.remove(LOCAL_PREFIX + key);
  }

  /** Moves local-only notes into sync while there is room, oldest first. */
  async function promote() {
    const waiting = [...localOnly.values()].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    for (const note of waiting) {
      if (synced.has(note.film) && Date.parse(synced.get(note.film).updatedAt) >= Date.parse(note.updatedAt)) {
        await dropLocal(note.film); // a newer copy arrived through sync
        emit(note.film);
        continue;
      }
      if (!(await trySync({ ...note, local: false }))) break;
      synced.set(note.film, { ...note, local: false });
      await dropLocal(note.film);
      emit(note.film);
    }
  }

  /* ------------------------------------------------------------------ init */

  async function load() {
    const [syncAll, localAll] = await Promise.all([sync.get(null), local.get(null)]);

    for (const [k, v] of Object.entries(syncAll)) {
      if (!k.startsWith(SYNC_PREFIX)) continue;
      const note = fromCompact(k.slice(SYNC_PREFIX.length), v);
      if (note) synced.set(note.film, note);
    }

    const legacy = [];
    for (const [k, v] of Object.entries(localAll)) {
      if (!k.startsWith(LOCAL_PREFIX) || !isLocalNote(v)) continue;
      if (v.local) localOnly.set(v.film, v);
      else legacy.push(v); // version 1: not yet offered to sync
    }

    // Version 1 → 2: move local notes into sync (newest copy wins).
    for (const note of legacy) {
      const remote = synced.get(note.film);
      if (!remote || Date.parse(note.updatedAt) > Date.parse(remote.updatedAt)) {
        if (await trySync({ ...note, local: false })) synced.set(note.film, { ...note, local: false });
        else {
          await writeLocal(note);
          continue;
        }
      }
      await local.remove(LOCAL_PREFIX + note.film);
    }
    if (localAll.schemaVersion !== SCHEMA_VERSION) await local.set({ schemaVersion: SCHEMA_VERSION });

    api.storage.onChanged.addListener((changes, area) => {
      for (const [k, { newValue }] of Object.entries(changes)) {
        let key = null;
        if (area === "sync" && k.startsWith(SYNC_PREFIX)) {
          key = k.slice(SYNC_PREFIX.length);
          const note = fromCompact(key, newValue);
          if (note) synced.set(key, note);
          else synced.delete(key);
        } else if (area === "local" && k.startsWith(LOCAL_PREFIX)) {
          key = k.slice(LOCAL_PREFIX.length);
          if (isLocalNote(newValue) && newValue.local) localOnly.set(key, newValue);
          else localOnly.delete(key);
        }
        if (key) emit(key);
      }
    });

    if (localOnly.size) await promote();
  }

  /** Loads every note once. Safe to call repeatedly. */
  function init() {
    ready ??= load();
    return ready;
  }

  /* ------------------------------------------------------------------- API */

  /**
   * Finds the note for a film descriptor (see `Whylisted.film.identify`).
   *
   * Looks the film up by its stable uid first. If a note was saved earlier
   * under the slug fallback (because the uid was not available then), it is
   * found by slug and moved to the uid key, so it is never orphaned.
   */
  function find(film) {
    const direct = resolve(film.key);
    if (direct) return direct;
    if (!film.uid || !film.slug) return null;

    const legacyKey = `slug:${film.slug}`;
    const legacy = resolve(legacyKey);
    if (!legacy) return null;
    const migrated = { ...legacy, film: film.uid };
    (legacy.local ? localOnly : synced).set(film.uid, migrated);
    synced.delete(legacyKey);
    localOnly.delete(legacyKey);
    (async () => {
      if (legacy.local) await writeLocal(migrated);
      else if (!(await trySync(migrated))) await writeLocal(migrated);
      await sync.remove(SYNC_PREFIX + legacyKey);
      await local.remove(LOCAL_PREFIX + legacyKey);
    })();
    return migrated;
  }

  /**
   * Creates, updates or (for blank text) deletes the note for a film.
   * @returns {Promise<object|null>} The stored note, or null if it was removed.
   */
  async function save(film, rawText) {
    const text = String(rawText ?? "").replace(/\s+$/, "").replace(/^\s*\n/, "").slice(0, MAX_LENGTH);
    if (!text.trim()) {
      await remove(film);
      return null;
    }

    const previous = find(film);
    if (previous && previous.text === text) return previous;

    const now = new Date().toISOString();
    const note = {
      film: film.key,
      slug: film.slug,
      title: film.title,
      year: film.year,
      text,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      local: false,
    };

    // Show the change immediately, then persist it.
    synced.set(film.key, note);
    emit(film.key);

    if (await trySync(note)) {
      await dropLocal(film.key);
      return note;
    }
    // Doesn't fit: keep it here, and remove any older synced copy so other devices don't show stale text.
    synced.delete(film.key);
    await sync.remove(SYNC_PREFIX + film.key).catch(() => {});
    const kept = await writeLocal(note);
    emit(film.key);
    return kept;
  }

  async function remove(film) {
    const had = synced.delete(film.key) | localOnly.delete(film.key);
    if (!had) return;
    emit(film.key);
    await Promise.all([sync.remove(SYNC_PREFIX + film.key), local.remove(LOCAL_PREFIX + film.key)]);
    if (localOnly.size) await promote();
  }

  /** Every note, one per film (the newer copy where a film has both a synced and a local one). */
  function all() {
    const keys = new Set([...synced.keys(), ...localOnly.keys()]);
    return [...keys].map(resolve).filter(Boolean);
  }

  /** Subscribes to note changes (local, from other tabs, or from other devices). Returns an unsubscribe function. */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  Whylisted.store = { init, find, all, save, remove, subscribe, MAX_LENGTH };
})();
