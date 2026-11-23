/**
 * Hover tooltip, modelled on Letterboxd's own "twipsy" tooltips (slate
 * background, small arrow, quick fade). Used for "Add a note" hints and for
 * previewing a saved note without opening the editor.
 */
(() => {
  "use strict";

  const P = Whylisted.PREFIX;
  const SHOW_DELAY = 120;
  const GAP = 6;
  const EDGE = 8;

  let el = null;
  let inner = null;
  let showTimer = 0;
  let anchor = null;

  function ensure() {
    if (el) return;
    el = document.createElement("div");
    el.className = `${P}-tip`;
    el.setAttribute("role", "tooltip");
    el.id = `${P}-tip`;
    inner = document.createElement("div");
    inner.className = `${P}-tip-inner`;
    const arrow = document.createElement("span");
    arrow.className = `${P}-tip-arrow`;
    el.append(inner, arrow);
    document.body.append(el);
  }

  function position() {
    if (!anchor?.isConnected) return hide(true);
    const a = anchor.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;

    const above = a.top - t.height - GAP >= EDGE;
    const top = above ? a.top - t.height - GAP : a.bottom + GAP;
    const centre = a.left + a.width / 2;
    const left = Math.min(Math.max(centre - t.width / 2, EDGE), vw - t.width - EDGE);

    el.classList.toggle("-below", !above);
    el.style.setProperty("--arrow-x", `${centre - left}px`);
    el.style.transform = `translate(${Math.round(left + scrollX)}px, ${Math.round(top + scrollY)}px)`;
  }

  /**
   * @param {Element} target  Element the tooltip points at.
   * @param {string} text
   * @param {{ variant?: "label" | "note" }} [options]  "note" renders multi-line body text.
   */
  function show(target, text, { variant = "label" } = {}) {
    ensure();
    clearTimeout(showTimer);
    const delay = el.classList.contains("-visible") ? 0 : SHOW_DELAY;
    showTimer = setTimeout(() => {
      anchor = target;
      inner.textContent = text;
      el.classList.toggle("-note", variant === "note");
      target.setAttribute("aria-describedby", el.id);
      position();
      el.classList.add("-visible");
    }, delay);
  }

  function hide(immediate = false) {
    clearTimeout(showTimer);
    if (!el) return;
    anchor?.removeAttribute("aria-describedby");
    anchor = null;
    el.classList.remove("-visible");
    if (immediate) el.classList.add("-instant"), requestAnimationFrame(() => el?.classList.remove("-instant"));
  }

  Whylisted.tooltip = { show, hide };
})();
