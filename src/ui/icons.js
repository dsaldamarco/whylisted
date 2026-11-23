/**
 * Inline SVG glyphs, built with DOM APIs (no innerHTML on the host page).
 */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svg(viewBox, paths) {
    const el = document.createElementNS(SVG_NS, "svg");
    el.setAttribute("viewBox", viewBox);
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("focusable", "false");
    for (const d of paths) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      el.append(p);
    }
    return el;
  }

  Whylisted.icons = {
    /** Three lines of text, the last one shorter: "there is a note here". */
    note: () => svg("0 0 16 16", ["M3 4.25h10", "M3 8h10", "M3 11.75h6"]),
    /** Plus: "add a note". */
    add: () => svg("0 0 16 16", ["M8 3.25v9.5", "M3.25 8h9.5"]),
  };
})();
