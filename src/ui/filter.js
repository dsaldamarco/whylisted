/**
 * "Notes" menu in the Watchlist's filter bar: search your notes and filter the grid.
 *
 * It sits with Letterboxd's own Decade / Genre / Service / Sort menus and is
 * styled like them, using their label markup (`.smenu-wrapper > .smenu > label`)
 * so the uppercase label and chevron are the site's own. The dropdown is
 * Whylisted's, so it doesn't depend on Letterboxd's menu script.
 *
 * - Search matches note text (ignoring case and accents). The grid on this page
 *   shows only films whose note matches, and the menu lists every matching note
 *   across all your notes, because a Watchlist is split into pages of 28.
 * - "Show" filters this page to films with or without a note.
 * - Both are kept for the tab session, so they survive paging through the Watchlist.
 */
(() => {
  "use strict";

  const P = Whylisted.PREFIX;
  const { store, badge } = Whylisted;

  const SESSION_KEY = `${P}:filter`;
  const HIDDEN = `${P}-filtered-out`;
  const MAX_RESULTS = 60;
  const MODES = [
    ["all", "All films"],
    ["with", "Films with a note"],
    ["without", "Films without a note"],
  ];

  let state = readState();
  let ui = null;
  let open = false;

  /* ----------------------------------------------------------------- state */

  function readState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (saved && MODES.some(([m]) => m === saved.mode)) return { mode: saved.mode, query: String(saved.query ?? "") };
    } catch {
      /* storage unavailable or corrupt: start clean */
    }
    return { mode: "all", query: "" };
  }

  function writeState() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      /* not critical */
    }
  }

  const fold = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const active = () => state.mode !== "all" || state.query.trim() !== "";

  function matches(note) {
    const q = fold(state.query.trim());
    return !q || (note && fold(note.text).includes(q));
  }

  /* ------------------------------------------------------------------ grid */

  /** Shows or hides each poster on the page. Called after every scan and note change. */
  function apply() {
    if (!ui?.root.isConnected) return;
    let shown = 0;
    let total = 0;
    for (const host of document.querySelectorAll(`.${P}-host`)) {
      const film = badge.filmOf(host);
      if (!film || !host.closest(".poster-grid")) continue;
      const note = store.find(film);
      const visible =
        (state.mode === "all" || (state.mode === "with" ? Boolean(note) : !note)) && (!state.query.trim() || matches(note));
      host.classList.toggle(HIDDEN, !visible);
      total++;
      if (visible) shown++;
    }
    renderLabel();
    renderEmpty(shown, total);
    if (open) renderPanel(shown, total);
  }

  function renderLabel() {
    const q = state.query.trim();
    let text = "Notes";
    if (q) text = `Notes: “${q.length > 16 ? `${q.slice(0, 15)}…` : q}”`;
    else if (state.mode === "with") text = "With notes";
    else if (state.mode === "without") text = "Without notes";
    ui.labelText.textContent = text;
    ui.root.classList.toggle("-active", active());
  }

  /** A quiet message in place of the grid when nothing on this page matches. */
  function renderEmpty(shown, total) {
    const grid = document.querySelector(".poster-grid");
    if (!grid) return;
    let empty = document.querySelector(`.${P}-empty`);
    if (!active() || shown > 0 || total === 0) {
      empty?.remove();
      return;
    }
    const q = state.query.trim();
    const message = q
      ? `No film on this page has a note matching “${q}”. `
      : state.mode === "with"
        ? "No film on this page has a note yet. "
        : "Every film on this page has a note. ";
    if (empty?.dataset.message === message) return;
    if (!empty) {
      empty = document.createElement("p");
      empty.className = `${P}-empty`;
      grid.before(empty);
    }
    empty.dataset.message = message;
    empty.replaceChildren(message);
    const link = document.createElement("button");
    link.type = "button";
    link.className = `${P}-linkbutton`;
    link.textContent = q ? "See all matching notes" : "Show all films";
    link.addEventListener("click", () => (q ? show() : setMode("all")));
    empty.append(link);
  }

  /* ----------------------------------------------------------------- panel */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function build(bar) {
    // Letterboxd's own label markup, so the label and chevron look like the neighbouring menus.
    const root = el("section", `smenu-wrapper ${P}-notes-menu`);
    const smenu = el("div", "smenu");
    const label = el("label", `${P}-notes-label`);
    label.setAttribute("role", "button");
    label.setAttribute("tabindex", "0");
    label.setAttribute("aria-haspopup", "dialog");
    label.setAttribute("aria-expanded", "false");
    const labelText = el("span", `${P}-notes-label-text`, "Notes");
    label.append(labelText, el("i", "ir s icon"));
    smenu.append(label);

    const panel = el("div", `${P}-menu`);
    panel.id = `${P}-notes-panel`;
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Search and filter by note");
    label.setAttribute("aria-controls", panel.id);

    const search = el("div", `${P}-menu-search`);
    const input = el("input", `${P}-menu-input`);
    input.type = "search";
    input.placeholder = "Search your notes…";
    input.setAttribute("aria-label", "Search your notes");
    input.spellcheck = false;
    input.value = state.query;
    search.append(input);

    const showLabel = el("p", `${P}-menu-sublabel`, "Show on this page");
    const modes = el("div", `${P}-menu-modes`);
    modes.setAttribute("role", "radiogroup");
    modes.setAttribute("aria-label", "Show on this page");
    const modeButtons = MODES.map(([mode, text]) => {
      const b = el("button", `${P}-menu-item`, text);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.mode = mode;
      b.addEventListener("click", () => setMode(mode));
      modes.append(b);
      return b;
    });
    const pageCount = el("p", `${P}-menu-count`);

    const resultsLabel = el("p", `${P}-menu-sublabel ${P}-menu-divider`);
    const results = el("ul", `${P}-menu-results`);

    panel.append(search, showLabel, modes, pageCount, resultsLabel, results);
    smenu.append(panel);
    root.append(smenu);
    // The filter bar floats its menus right, so the last one is the leftmost: Notes comes first visually.
    bar.append(root);

    label.addEventListener("click", (e) => {
      e.preventDefault();
      open ? hide() : show();
    });
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        show();
      }
    });
    input.addEventListener("input", () => {
      state.query = input.value;
      writeState();
      apply();
    });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        hide();
        label.focus();
      }
    });

    return { root, label, labelText, panel, input, modeButtons, pageCount, resultsLabel, results };
  }

  /** Highlights the first match of the query in a snippet of the note. */
  function snippet(text, query) {
    const flat = text.replace(/\s+/g, " ").trim();
    const span = el("span", `${P}-result-note`);
    const q = fold(query.trim());
    const at = q ? fold(flat).indexOf(q) : -1;
    if (at < 0) {
      span.textContent = flat.length > 110 ? `${flat.slice(0, 109)}…` : flat;
      return span;
    }
    // Folding can change length for some characters; fall back to plain text if it does.
    if (fold(flat).length !== flat.length) {
      span.textContent = flat.length > 110 ? `${flat.slice(0, 109)}…` : flat;
      return span;
    }
    const start = Math.max(0, at - 40);
    const end = Math.min(flat.length, at + q.length + 60);
    span.append(
      (start > 0 ? "…" : "") + flat.slice(start, at),
      el("mark", `${P}-result-mark`, flat.slice(at, at + q.length)),
      flat.slice(at + q.length, end) + (end < flat.length ? "…" : "")
    );
    return span;
  }

  function renderPanel(shown, total) {
    for (const b of ui.modeButtons) {
      const selected = b.dataset.mode === state.mode;
      b.setAttribute("aria-checked", String(selected));
      b.classList.toggle("-selected", selected);
    }
    ui.pageCount.textContent = active() ? `${shown} of ${total} films on this page` : `${total} films on this page`;

    const q = state.query.trim();
    const all = store.all().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const found = q ? all.filter(matches) : all;
    ui.resultsLabel.textContent = q
      ? `${found.length} matching ${found.length === 1 ? "note" : "notes"}`
      : `All your notes · ${all.length}`;

    ui.results.replaceChildren();
    if (!found.length) {
      ui.results.append(el("li", `${P}-result-empty`, q ? "No notes match." : "No notes yet. Hover a poster and click + to add one."));
      return;
    }
    for (const note of found.slice(0, MAX_RESULTS)) {
      const li = el("li");
      const a = el(note.slug ? "a" : "span", `${P}-result`);
      if (note.slug) a.href = `/film/${note.slug}/`;
      const title = el("span", `${P}-result-title`, note.title || note.slug || "Untitled");
      if (note.year) title.append(el("span", `${P}-result-year`, ` ${note.year}`));
      a.append(title, snippet(note.text, q));
      li.append(a);
      ui.results.append(li);
    }
    if (found.length > MAX_RESULTS) {
      ui.results.append(el("li", `${P}-result-empty`, `…and ${found.length - MAX_RESULTS} more. Refine your search.`));
    }
  }

  function onOutside(e) {
    if (!ui.root.contains(e.target)) hide();
  }

  function show() {
    if (open || !ui) return;
    open = true;
    ui.panel.hidden = false;
    ui.label.setAttribute("aria-expanded", "true");
    // The filter bar is its own stacking layer (z-index 0) and the poster grid after it paints on
    // top; lift the bar while the menu is open, as Letterboxd's own menus need.
    ui.root.closest(".sorting-selects")?.classList.add(`${P}-bar-raised`);
    apply();
    requestAnimationFrame(() => ui.panel.classList.add("-open"));
    ui.input.focus({ preventScroll: true });
    ui.input.select();
    document.addEventListener("pointerdown", onOutside, true);
  }

  function hide() {
    if (!open) return;
    open = false;
    ui.label.setAttribute("aria-expanded", "false");
    ui.panel.classList.remove("-open");
    setTimeout(() => {
      if (open || !ui) return;
      ui.panel.hidden = true;
      ui.root.closest(".sorting-selects")?.classList.remove(`${P}-bar-raised`);
    }, Whylisted.prefersReducedMotion() ? 0 : 150);
    document.removeEventListener("pointerdown", onOutside, true);
  }

  function setMode(mode) {
    state.mode = mode;
    writeState();
    apply();
  }

  /* ------------------------------------------------------------- lifecycle */

  /** Adds the menu to the Watchlist's filter bar (once). Returns false if there is no bar. */
  function mount() {
    if (ui?.root.isConnected) return true;
    const bar = document.querySelector(".js-watchlist-content .sorting-selects, #content-nav .sorting-selects");
    if (!bar || !document.querySelector(".poster-grid")) return false;
    ui = build(bar);
    apply();
    return true;
  }

  function unmount() {
    hide();
    ui?.root.remove();
    ui = null;
    document.querySelector(`.${P}-empty`)?.remove();
    for (const host of document.querySelectorAll(`.${HIDDEN}`)) host.classList.remove(HIDDEN);
  }

  Whylisted.filter = { mount, unmount, apply };
})();
