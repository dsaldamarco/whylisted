/**
 * Entry point: finds posters (every one in a Watchlist, the cover on a film
 * page) and keeps their badges in sync.
 *
 * Letterboxd mixes server-rendered HTML with React islands and swaps grid
 * contents in place when you sort, filter or page through a Watchlist. A
 * single MutationObserver (batched to one scan per animation frame) handles
 * all of it: new posters get a badge, posters whose film changed get a fresh
 * one, and nothing ever depends on an item's position in the grid.
 */
(() => {
  "use strict";

  const P = Whylisted.PREFIX;
  const { film, store, badge, editor, filter } = Whylisted;

  /**
   * Where badges appear. Each context pairs a URL pattern with the
   * server-rendered element that wraps a poster (the badge's host).
   */
  const CONTEXTS = [
    {
      // `/<username>/watchlist/…`, including paging, sorting and filters: every poster in the grid.
      path: /^\/[^/]+\/watchlist(\/|$)/,
      hosts: ".poster-grid li, ul.poster-list > li, .js-watchlist-content li.griditem",
      // The "Notes" search & filter menu in the Watchlist's filter bar.
      filter: true,
    },
    {
      // `/film/<slug>/…` (and its tabs: reviews, cast, details…): only the film's own large cover,
      // not the "similar films" or other poster lists further down the page.
      path: /^\/film\/[^/]+(\/|$)/,
      hosts: "#js-poster-col > .poster-list.-single, .col-poster-large > .poster-list.-single",
    },
  ];

  let scheduled = false;
  let active = false;

  const currentContext = () => CONTEXTS.find((c) => c.path.test(location.pathname)) ?? null;

  function scan() {
    scheduled = false;

    const context = currentContext();
    if (!context) {
      if (active) teardown();
      return;
    }
    active = true;
    document.documentElement.classList.add(`${P}-on`);

    for (const host of document.querySelectorAll(context.hosts)) {
      const descriptor = film.identify(host);
      if (descriptor) badge.attach(host, descriptor);
    }

    if (context.filter && filter.mount()) filter.apply();
    else filter.unmount();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  function teardown() {
    active = false;
    editor.close({ restoreFocus: false });
    filter.unmount();
    document.documentElement.classList.remove(`${P}-on`);
    for (const host of document.querySelectorAll(`.${P}-host`)) badge.detach(host);
  }

  /** Re-renders every badge showing `filmKey` (several can, e.g. duplicates across tabs). */
  function refresh(filmKey) {
    for (const host of document.querySelectorAll(`.${P}-host`)) {
      const f = badge.filmOf(host);
      if (!f || (f.key !== filmKey && `slug:${f.slug}` !== filmKey)) continue;
      const hadNote = host.classList.contains(`${P}-has-note`);
      badge.render(host);
      if (!hadNote && host.classList.contains(`${P}-has-note`)) badge.pulse(host);
    }
    // A changed note can change which films the search & filter shows.
    filter.apply();
  }

  /** Everything Whylisted itself puts on the page (its changes must not trigger another scan). */
  const OWN_UI = `.${P}-pop, .${P}-tip, .${P}-badge, .${P}-notes-menu, .${P}-empty`;
  const isOwnNode = (node) => node instanceof Element && node.matches(OWN_UI);

  function isOwnMutation(mutation) {
    const t = mutation.target;
    if (t instanceof Element && t.closest(OWN_UI)) return true;
    // Whylisted adding or removing one of its own elements (e.g. the "no matches" message).
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return mutation.type === "childList" && nodes.length > 0 && nodes.every(isOwnNode);
  }

  async function start() {
    try {
      await store.init();
    } catch (err) {
      console.error("[Whylisted] Could not read notes from storage.", err);
      return;
    }

    store.subscribe(refresh);

    new MutationObserver((mutations) => {
      if (mutations.every(isOwnMutation)) return;
      schedule();
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // Posters hydrate by gaining these attributes; React may also reuse a node for a different film.
      attributeFilter: ["data-production-uid", "data-postered-identifier", "data-item-slug", "data-film-id"],
    });

    // Letterboxd can change the URL without a full load (e.g. filters); also handle back/forward.
    window.addEventListener("popstate", schedule);
    window.addEventListener("pageshow", schedule);
    window.addEventListener("resize", () => {
      for (const host of document.querySelectorAll(`.${P}-host`)) badge.measure(host);
    });

    scan();
  }

  start();
})();
