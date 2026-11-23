/**
 * Film identification.
 *
 * Notes must follow the *film*, never its position in a grid. Letterboxd
 * exposes a stable, numeric production id on every poster:
 *
 *   <div class="react-component" data-component-class="LazyPoster"
 *        data-postered-identifier='{"uid":"film:1041139", ...}'
 *        data-item-slug="la-gradiva" data-item-full-display-name="La Gradiva (2026)">
 *     <div class="poster film-poster" data-production-uid="film:1041139">…
 *
 * The `film:<number>` uid is the primary key. The slug (`/film/<slug>/`) is kept
 * as a fallback and as human-readable metadata, but slugs can change when
 * Letterboxd renames or disambiguates a film, so they are never preferred.
 */
(() => {
  "use strict";

  const UID_PATTERN = /^film:\d+$/;
  const SLUG_FROM_LINK = /\/film\/([^/]+)\/?/;
  const TITLE_YEAR = /^(.*?)\s*\((\d{4})\)\s*$/;

  /** Selectors for the element that carries a poster's film data, newest markup first. */
  const POSTER_DATA_SELECTOR = [
    "[data-postered-identifier]",
    "[data-production-uid]",
    "[data-film-id]",
    "[data-item-slug]",
    "[data-film-slug]",
  ].join(",");

  function parseJSON(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function firstUid(...candidates) {
    for (const c of candidates) {
      if (typeof c === "string" && UID_PATTERN.test(c)) return c;
    }
    return null;
  }

  /**
   * Builds a film descriptor from the DOM inside a poster grid item.
   *
   * @param {Element} host  The grid item (`li.griditem`) or any ancestor of one poster.
   * @returns {{key: string, uid: string|null, slug: string|null, title: string, year: string|null} | null}
   *   `null` when the element does not (yet) describe a film.
   */
  function identify(host) {
    const data = host.matches(POSTER_DATA_SELECTOR) ? host : host.querySelector(POSTER_DATA_SELECTOR);
    if (!data) return null;

    const poster = host.querySelector("[data-production-uid]");
    const identifier = parseJSON(data.getAttribute("data-postered-identifier"));
    const legacyId = data.getAttribute("data-film-id");

    const uid = firstUid(
      poster?.getAttribute("data-production-uid"),
      identifier?.uid,
      data.getAttribute("data-production-uid"),
      legacyId ? `film:${legacyId}` : null
    );

    const link =
      data.getAttribute("data-target-link") ||
      data.getAttribute("data-item-link") ||
      data.getAttribute("data-film-link") ||
      host.querySelector('a[href*="/film/"]')?.getAttribute("href") ||
      "";
    const slug =
      data.getAttribute("data-item-slug") ||
      data.getAttribute("data-film-slug") ||
      link.match(SLUG_FROM_LINK)?.[1] ||
      null;

    if (!uid && !slug) return null;

    const fullName =
      data.getAttribute("data-item-full-display-name") ||
      data.getAttribute("data-item-name") ||
      host.querySelector("img[alt]")?.getAttribute("alt")?.replace(/^Poster for\s+/, "") ||
      slug ||
      "";
    const [, name, year] = fullName.match(TITLE_YEAR) || [null, fullName, null];

    return {
      key: uid || `slug:${slug}`,
      uid,
      slug,
      title: name.trim(),
      year,
    };
  }

  Whylisted.film = { identify, POSTER_DATA_SELECTOR };
})();
