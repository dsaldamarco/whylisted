/**
 * Note storage.
 *
 * Notes live in `browser.storage.local`, one key per film:
 *
 *   "schemaVersion": 1
 *   "note:film:1041139": {
 *     "film":      "film:1041139",   // Letterboxd production uid (or "slug:<slug>" as a fallback)
 *     "slug":      "la-gradiva",     // for humans, exports and fallback matching
 *     "title":     "La Gradiva",
 *     "year":      "2026",
 *     "text":      "Recommended by Marco.",
 *     "createdAt": "2026-11-23T10:12:00.000Z",
 *     "updatedAt": "2026-11-23T10:12:00.000Z"
 *   }
 *
 * One key per note keeps writes small, lets `storage.onChanged` report exactly
 * which film changed (so several open tabs stay in sync), and makes a future
 * export/import or sync a matter of reading or writing the `note:` keys.
 */
(() => {
  "use strict";

  const SCHEMA_VERSION = 1;
  const NOTE_PREFIX = "note:";
  /** Generous ceiling; a note is a reminder, not an essay. */
  const MAX_LENGTH = 2000;

  const api = globalThis.browser ?? globalThis.chrome;
  const area = api.storage.local;

  /** @type {Map<string, object>} film key → note */
  const notes = new Map();
  /** @type {Set<(key: string) => void>} */
  const listeners = new Set();
  let ready = null;

  const storageKey = (filmKey) => NOTE_PREFIX + filmKey;

  function emit(filmKey) {
    for (const fn of listeners) {
      try {
        fn(filmKey);
      } catch (err) {
        console.error("[Whylisted]", err);
      }
    }
  }

  function isNote(value) {
    return value && typeof value === "object" && typeof value.text === "string" && typeof value.film === "string";
  }

  async function load() {
    const all = await area.get(null);
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(NOTE_PREFIX) && isNote(value)) notes.set(key.slice(NOTE_PREFIX.length), value);
    }
    if (all.schemaVersion !== SCHEMA_VERSION) await area.set({ schemaVersion: SCHEMA_VERSION });

    // Keep in sync with edits made in other tabs.
    api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (!key.startsWith(NOTE_PREFIX)) continue;
        const filmKey = key.slice(NOTE_PREFIX.length);
        if (isNote(newValue)) notes.set(filmKey, newValue);
        else notes.delete(filmKey);
        emit(filmKey);
      }
    });
  }

  /** Loads every note once. Safe to call repeatedly. */
  function init() {
    ready ??= load();
    return ready;
  }

  /**
   * Finds the note for a film descriptor (see `Whylisted.film.identify`).
   *
   * Looks the film up by its stable uid first. If a note was saved earlier
   * under the slug fallback (because the uid was not available then), it is
   * found by slug and moved to the uid key, so it is never orphaned.
   */
  function find(film) {
    const direct = notes.get(film.key);
    if (direct) return direct;
    if (!film.uid || !film.slug) return null;

    const legacy = notes.get(`slug:${film.slug}`);
    if (!legacy) return null;
    const migrated = { ...legacy, film: film.uid };
    notes.set(film.uid, migrated);
    notes.delete(`slug:${film.slug}`);
    area.set({ [storageKey(film.uid)]: migrated }).then(() => area.remove(storageKey(`slug:${film.slug}`)));
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
    };
    notes.set(film.key, note);
    emit(film.key);
    await area.set({ [storageKey(film.key)]: note });
    return note;
  }

  async function remove(film) {
    if (!notes.has(film.key)) return;
    notes.delete(film.key);
    emit(film.key);
    await area.remove(storageKey(film.key));
  }

  /** Subscribes to note changes (local or from other tabs). Returns an unsubscribe function. */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  Whylisted.store = { init, find, save, remove, subscribe, MAX_LENGTH };
})();
