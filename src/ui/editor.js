/**
 * The note editor: a small popover anchored to a poster.
 *
 * Visual language is borrowed from Letterboxd's own dialogs (it opts into the
 * site's `data-theme="dialog"` colour tokens) and from its private-note
 * textarea, so the editor reads as part of the page rather than an add-on.
 *
 * Keyboard:  Ctrl/⌘+Enter saves · Esc cancels · Tab stays inside the popover.
 * Clicking outside saves any changes, so a note is never lost by accident.
 */
(() => {
  "use strict";

  const P = Whylisted.PREFIX;
  const { store, icons } = Whylisted;

  const GAP = 12;
  const EDGE = 16;
  const NARROW = 544; // Letterboxd's own mobile breakpoint
  const CONFIRM_TIMEOUT = 4000;
  const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const PLACEHOLDERS = [
    "A friend’s recommendation, a review you read, a clip you loved…",
    "Who recommended it? What caught your eye?",
    "Why did you add this one?",
  ];

  /** @type {{ film: object, host: Element, anchor: Element, original: string } | null} */
  let current = null;
  let ui = null;
  let confirmTimer = 0;
  let closingTimer = 0;

  /* ------------------------------------------------------------------ build */

  function el(tag, className, attrs = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function build() {
    const root = el("div", `${P}-pop`, {
      role: "dialog",
      "aria-modal": "false",
      "aria-labelledby": `${P}-pop-film`,
      "data-theme": "dialog",
      hidden: "",
    });
    const arrow = el("span", `${P}-pop-arrow`);

    const head = el("header", `${P}-pop-head`);
    const eyebrow = el("p", `${P}-pop-eyebrow`);
    eyebrow.append(icons.note(), document.createTextNode("Why it’s on your watchlist"));
    const filmLine = el("h2", `${P}-pop-film`, { id: `${P}-pop-film` });
    const filmTitle = el("span", `${P}-pop-title`);
    const filmYear = el("span", `${P}-pop-year`);
    filmLine.append(filmTitle, filmYear);
    head.append(eyebrow, filmLine);

    const field = el("div", `${P}-pop-field`);
    const textarea = el("textarea", `${P}-pop-text`, {
      rows: "3",
      maxlength: String(store.MAX_LENGTH),
      spellcheck: "true",
      "aria-label": "Note",
    });
    field.append(textarea);

    const foot = el("footer", `${P}-pop-foot`);
    const meta = el("span", `${P}-pop-meta`);
    const actions = el("div", `${P}-pop-actions`);
    const del = el("button", `${P}-btn -text -destructive`, { type: "button" });
    const save = el("button", `${P}-btn -primary`, { type: "button" });
    save.textContent = "Save";
    actions.append(del, save);
    foot.append(meta, actions);

    root.append(arrow, head, field, foot);
    document.body.append(root);

    textarea.addEventListener("input", () => {
      autosize();
      updateDirty();
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
    });
    save.addEventListener("click", commit);
    del.addEventListener("click", onDelete);
    del.addEventListener("blur", resetDelete);
    root.addEventListener("keydown", onKeydown);

    return { root, arrow, filmTitle, filmYear, textarea, meta, del, save, field };
  }

  /* --------------------------------------------------------------- behaviour */

  function autosize() {
    const t = ui.textarea;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }

  function updateDirty() {
    const dirty = ui.textarea.value.trim() !== current.original.trim();
    ui.root.classList.toggle("-dirty", dirty);
    ui.save.disabled = !dirty && !current.original;
  }

  function describe(note) {
    if (!note) return "";
    const created = new Date(note.createdAt);
    const updated = new Date(note.updatedAt);
    const edited = updated - created > 60_000;
    return `${edited ? "Edited" : "Added"} ${DATE_FORMAT.format(edited ? updated : created)}`;
  }

  function resetDelete() {
    clearTimeout(confirmTimer);
    if (!ui) return;
    ui.del.classList.remove("-confirm");
    ui.del.textContent = "Delete";
  }

  async function onDelete() {
    if (!ui.del.classList.contains("-confirm")) {
      ui.del.classList.add("-confirm");
      ui.del.textContent = "Delete?";
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(resetDelete, CONFIRM_TIMEOUT);
      return;
    }
    const { film } = current;
    close();
    await store.remove(film);
  }

  async function commit() {
    if (!current) return;
    const { film, original } = current;
    const text = ui.textarea.value;
    close();
    if (text.trim() !== original.trim()) await store.save(film, text);
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // Keep focus inside the popover while it is open.
    const focusables = [ui.textarea, ui.del, ui.save].filter((n) => !n.hidden && !n.disabled);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onPointerDownOutside(e) {
    if (!current) return;
    if (ui.root.contains(e.target) || current.anchor.contains(e.target)) return;
    commit();
  }

  function onReflow() {
    if (!current) return;
    if (!current.host.isConnected) return close({ restoreFocus: false });
    position();
  }

  /* ----------------------------------------------------------------- layout */

  /**
   * Places the popover beside the poster (right, then left), or below/above it
   * on narrow screens. Coordinates are document-relative so the popover scrolls
   * with the page instead of floating over it.
   */
  function position() {
    const { root, arrow } = ui;
    const posterEl = current.host.querySelector(".film-poster, .poster") || current.host;
    const r = posterEl.getBoundingClientRect();
    const badge = current.anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;

    root.style.width = "";
    const narrow = vw < NARROW;
    if (narrow) root.style.width = `${vw - EDGE * 2}px`;
    const w = root.offsetWidth;
    const h = root.offsetHeight;

    let side;
    let left;
    let top;
    if (!narrow && r.right + GAP + w <= vw - EDGE) side = "right";
    else if (!narrow && r.left - GAP - w >= EDGE) side = "left";
    else side = r.bottom + GAP + h <= vh - EDGE || r.top - GAP - h < EDGE ? "below" : "above";

    if (side === "right" || side === "left") {
      left = side === "right" ? r.right + GAP : r.left - GAP - w;
      // Align the top of the popover with the poster, nudged to stay on screen.
      top = Math.min(Math.max(r.top - 4, EDGE), Math.max(vh - h - EDGE, EDGE));
      const arrowY = Math.min(Math.max(badge.top + badge.height / 2 - top, 14), h - 14);
      arrow.style.setProperty("--arrow-y", `${arrowY}px`);
    } else {
      left = Math.min(Math.max(r.left + r.width / 2 - w / 2, EDGE), vw - w - EDGE);
      top = side === "below" ? r.bottom + GAP : r.top - GAP - h;
      arrow.style.setProperty("--arrow-x", `${r.left + r.width / 2 - left}px`);
    }

    root.dataset.side = side;
    root.style.left = `${Math.round(left + scrollX)}px`;
    root.style.top = `${Math.round(top + scrollY)}px`;
  }

  /* -------------------------------------------------------------- open/close */

  /**
   * Opens the editor for a film.
   * @param {{ film: object, host: Element, anchor: Element }} target
   */
  function open({ film, host, anchor }) {
    if (current?.film.key === film.key) return;
    if (current) commit();

    ui ??= build();
    clearTimeout(closingTimer);
    resetDelete();

    const note = store.find(film);
    current = { film, host, anchor, original: note?.text ?? "" };

    ui.filmTitle.textContent = film.title || film.slug || "Untitled";
    ui.filmYear.textContent = film.year ? ` ${film.year}` : "";
    ui.textarea.value = note?.text ?? "";
    ui.textarea.placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
    ui.meta.textContent = describe(note);
    ui.del.hidden = !note;
    ui.root.classList.toggle("-existing", Boolean(note));
    updateDirty();

    ui.root.hidden = false;
    ui.root.classList.remove("-open");
    autosize();
    position();
    // Next frame so the opening transition runs from the closed state.
    requestAnimationFrame(() => ui.root.classList.add("-open"));

    anchor.setAttribute("aria-expanded", "true");
    host.classList.add(`${P}-active`);

    ui.textarea.focus({ preventScroll: true });
    ui.textarea.setSelectionRange(ui.textarea.value.length, ui.textarea.value.length);

    document.addEventListener("pointerdown", onPointerDownOutside, true);
    window.addEventListener("resize", onReflow);
  }

  /** Closes without saving. */
  function close({ restoreFocus = true } = {}) {
    if (!current) return;
    const { anchor, host } = current;
    current = null;

    document.removeEventListener("pointerdown", onPointerDownOutside, true);
    window.removeEventListener("resize", onReflow);
    resetDelete();

    anchor.setAttribute("aria-expanded", "false");
    host.classList.remove(`${P}-active`);

    const hadFocus = ui.root.contains(document.activeElement);
    ui.root.classList.remove("-open");
    const duration = Whylisted.prefersReducedMotion() ? 0 : 160;
    closingTimer = setTimeout(() => {
      if (!current) ui.root.hidden = true;
    }, duration);
    if (restoreFocus && hadFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  }

  const openFor = () => current?.film.key ?? null;

  Whylisted.editor = { open, close, openFor };
})();
