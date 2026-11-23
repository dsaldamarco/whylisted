/**
 * Whylisted — shared namespace.
 *
 * Content scripts listed in the manifest run in order in the same isolated
 * world, so each module attaches itself to this single global object instead
 * of leaking names into the page.
 */
(() => {
  "use strict";

  if (globalThis.Whylisted) return;

  globalThis.Whylisted = {
    /** Prefix for every class, attribute and id the extension adds to the page. */
    PREFIX: "whylisted",

    /** Reads `prefers-reduced-motion` live, so changes apply without a reload. */
    prefersReducedMotion() {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    },
  };
})();
