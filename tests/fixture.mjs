/**
 * Builds a test fixture from a real Letterboxd Watchlist page.
 *
 * Automated browsers get Letterboxd's bot check (a Cloudflare challenge), so
 * the e2e test does not drive the live site. Instead it fetches the page's
 * HTML with a plain request, strips the scripts, and rewrites each poster into
 * the shape Letterboxd's React hydration produces in a real browser:
 *
 *   <div class="poster film-poster" data-production-uid="film:1041139">
 *     <img class="image" src="…/1041139-la-gradiva-0-125-0-187-crop.jpg" …>
 *     <a href="/film/la-gradiva/" class="frame"><span class="frame-title">…</span><span class="overlay"></span></a>
 *   </div>
 *
 * Markup, class names, data attributes, stylesheets, fonts and poster images
 * are all Letterboxd's own; only the JavaScript is missing. The fetched page is
 * not stored in the repository.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&amp;/g, "&");
const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function posterUrl(uid, slug, w, h) {
  const id = uid.split(":")[1];
  return `https://a.ltrbxd.com/resized/film-poster/${id.split("").join("/")}/${id}-${slug}-0-${w}-0-${h}-crop.jpg`;
}

/** Rewrites server-rendered LazyPoster placeholders into their hydrated form. */
function hydrate(html) {
  return html.replace(
    /(<div class="react-component" data-component-class="LazyPoster"[^>]*>)\s*<div class="poster film-poster">[\s\S]*?<\/span><\/span>\s*<\/div>/g,
    (match, open) => {
      const attr = (name) => decode(open.match(new RegExp(`${name}=(['"])(.*?)\\1`))?.[2] ?? "");
      const uid = JSON.parse(attr("data-postered-identifier") || "{}").uid;
      const slug = attr("data-item-slug");
      const title = attr("data-item-full-display-name");
      const link = attr("data-target-link");
      const empty = attr("data-empty-poster-src");
      const w = Number(attr("data-image-width")) || 125;
      const h = Number(attr("data-image-height")) || 187;
      if (!uid || !slug) return match;
      const t = escapeAttr(title);
      // Posters with a custom image use a URL we cannot derive; fall back to Letterboxd's empty poster.
      const fallback = empty ? ` onerror="this.onerror=null;this.removeAttribute('srcset');this.src='${escapeAttr(empty)}'"` : "";
      return (
        `${open}<div class="poster film-poster" data-production-uid="${uid}">` +
        // Letterboxd only serves 2:3 sizes it knows (e.g. 250×375, not 250×374).
        `<img width="${w}" height="${h}" alt="Poster for ${t}" class="image" src="${posterUrl(uid, slug, w, h)}" srcset="${posterUrl(uid, slug, w * 2, Math.round(w * 2 * 1.5))} 2x"${fallback}>` +
        `<a href="${escapeAttr(link)}" class="frame" data-original-title="${t}"><span class="frame-title">${t}</span><span class="overlay"></span></a>` +
        `</div>`
      );
    }
  );
}

/** Reverses the poster order and drops a few films: a stand-in for re-sorting/filtering. */
function reorder(html) {
  return html.replace(/(<ul class="grid[^"]*">)([\s\S]*?)(<\/ul>)/, (m, open, body, close) => {
    const items = body.match(/<li class="griditem">[\s\S]*?<\/li>/g) || [];
    const shuffled = items.reverse().filter((_, i) => i % 5 !== 2);
    return open + shuffled.join("\n") + close;
  });
}

/** Fetches a Letterboxd page and returns it script-free, with posters in their hydrated form. */
export async function buildPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);
  const raw = await res.text();
  if (!raw.includes("LazyPoster")) throw new Error(`${url} did not return any posters (bot check?)`);
  // Letterboxd's scripts swap these <html> classes on load; without that, parts of the page
  // (e.g. the film page's poster column) stay `visibility: hidden`.
  return hydrate(raw.replace(/<script\b[\s\S]*?<\/script>/gi, ""))
    .replace(/(<html[^>]*class="[^"]*)\bno-js\b/, "$1js")
    .replace(/(<html[^>]*class="[^"]*)\bcontext-client-unknown\b/, "$1context-client-not-app");
}

export async function buildFixtures(url) {
  const base = await buildPage(url);
  return { watchlist: base, sorted: reorder(base) };
}
