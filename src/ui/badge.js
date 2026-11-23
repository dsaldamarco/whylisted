/**
 * The poster badge.
 *
 * - Films with a note get a small blue badge in the poster's top-right
 *   corner, set into a cut-out in the poster (the same technique Letterboxd
 *   uses for avatars on attributed posters). Hovering it previews the note.
 * - Films without a note show a quiet "+" badge only on hover or keyboard focus.
 *
 * The badge is attached to the element wrapping the poster (`li.griditem` in
 * a Watchlist, `section.poster-list.-single` on a film page), which Letterboxd
 * renders on the server, never inside the React-managed poster, so
 * re-renders on Letterboxd's side cannot remove it or be confused by it.
 */
(() => {
  "use strict";

  const P = Whylisted.PREFIX;
  const { store, icons, tooltip, editor } = Whylisted;

  const HOST = `${P}-host`;
  const HAS_NOTE = `${P}-has-note`;
  const SMALL = `${P}-small`;
  const LARGE = `${P}-large`;
  const SMALL_POSTER_WIDTH = 100;
  const LARGE_POSTER_WIDTH = 180;

  /** @type {WeakMap<Element, { film: object, button: HTMLButtonElement }>} */
  const attached = new WeakMap();

  function preview(text) {
    const flat = text.trim();
    return flat.length > 280 ? `${flat.slice(0, 279).trimEnd()}…` : flat;
  }

  function createButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${P}-badge`;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    const add = icons.add();
    add.classList.add(`${P}-glyph-add`);
    const note = icons.note();
    note.classList.add(`${P}-glyph-note`);
    button.append(add, note);
    return button;
  }

  function onEnter(e) {
    // On focus, only show the tooltip for keyboard focus: not when the editor hands focus back
    // after a click (that would pop a tooltip the user didn't ask for).
    if (e.type === "focus" && !e.currentTarget.matches(":focus-visible")) return;
    const host = e.currentTarget.closest(`.${HOST}`);
    const entry = host && attached.get(host);
    if (!entry || editor.openFor() === entry.film.key) return;
    const note = store.find(entry.film);
    if (note) tooltip.show(entry.button, preview(note.text), { variant: "note" });
    else tooltip.show(entry.button, "Add a note");
  }

  function onLeave() {
    tooltip.hide();
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const host = e.currentTarget.closest(`.${HOST}`);
    const entry = host && attached.get(host);
    if (!entry) return;
    tooltip.hide(true);
    if (editor.openFor() === entry.film.key) editor.close();
    else editor.open({ film: entry.film, host, anchor: entry.button });
  }

  /** Re-renders a badge's state from storage. */
  function render(host) {
    const entry = attached.get(host);
    if (!entry) return;
    const { film, button } = entry;
    const note = store.find(film);
    const name = film.title || film.slug;
    host.classList.toggle(HAS_NOTE, Boolean(note));
    button.setAttribute("aria-label", note ? `Note for ${name}: ${preview(note.text)}` : `Add a note for ${name}`);
  }

  function measure(host) {
    const poster = host.querySelector(".film-poster, .poster");
    const width = poster?.getBoundingClientRect().width || 0;
    host.classList.toggle(SMALL, width > 0 && width < SMALL_POSTER_WIDTH);
    host.classList.toggle(LARGE, width >= LARGE_POSTER_WIDTH);
  }

  /**
   * Attaches (or refreshes) the badge for one grid item.
   * Safe to call repeatedly: it only does work when the film in the item changed.
   */
  function attach(host, film) {
    const existing = attached.get(host);
    if (existing && existing.film.key === film.key && existing.button.isConnected) {
      existing.film = film; // title may have hydrated since
      return;
    }

    const button = existing?.button.isConnected ? existing.button : createButton();
    if (!button.isConnected) {
      button.addEventListener("click", onClick);
      button.addEventListener("pointerenter", onEnter);
      button.addEventListener("pointerleave", onLeave);
      button.addEventListener("focus", onEnter);
      button.addEventListener("blur", onLeave);
      host.append(button);
    }
    host.classList.add(HOST);
    attached.set(host, { film, button });
    measure(host);
    render(host);
  }

  /** Removes the badge and every class the extension added to the item. */
  function detach(host) {
    const entry = attached.get(host);
    entry?.button.remove();
    attached.delete(host);
    host.classList.remove(HOST, HAS_NOTE, SMALL, LARGE, `${P}-active`);
  }

  /** Celebrates a freshly created note with a small pop. */
  function pulse(host) {
    const button = attached.get(host)?.button;
    if (!button || Whylisted.prefersReducedMotion()) return;
    button.classList.remove(`${P}-pop-in`);
    void button.offsetWidth; // restart the animation
    button.classList.add(`${P}-pop-in`);
    button.addEventListener("animationend", () => button.classList.remove(`${P}-pop-in`), { once: true });
  }

  Whylisted.badge = { attach, detach, render, measure, pulse, filmOf: (host) => attached.get(host)?.film ?? null };
})();
