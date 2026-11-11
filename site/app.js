const CHAIN_COLORS = {
  AMC: "#ff5a5f",
  Regal: "#ffcc4d",
  Cinemark: "#5aa9ff",
  "Galaxy Theatres": "#c38bff",
};
const FALLBACK_COLORS = ["#94a3b8", "#fda4af", "#86efac", "#fcd34d", "#a5b4fc", "#67e8f9"];
const RECENT_DAYS = 28;

const state = { data: null, chain: "All", q: "" };

const $ = (sel) => document.querySelector(sel);

function chainColor(chain) {
  if (CHAIN_COLORS[chain]) return CHAIN_COLORS[chain];
  let h = 0;
  for (const c of chain) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

// ISO date strings are calendar dates; build them in local time so they
// don't shift a day in US time zones.
function parseDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function isoLocal(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function addDays(iso, n) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}
function weekThursday(iso) {
  const d = parseDate(iso);
  const back = (d.getDay() - 4 + 7) % 7;
  return addDays(iso, -back);
}
const fmt = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) =>
  parseDate(iso).toLocaleDateString(undefined, opts);

function relWeeks(thu, thisThu) {
  const today = isoLocal(new Date());
  const days = Math.round((parseDate(thu) - parseDate(today)) / 86400000);
  if (thu === thisThu) return "on sale now";
  if (days === 1) return "starts tomorrow";
  if (days > 1 && days < 7) return `starts in ${days} days`;
  const weeks = Math.round((parseDate(thu) - parseDate(thisThu)) / (7 * 86400000));
  if (weeks === -1) return "last week";
  return weeks > 0 ? `in ${weeks} weeks` : `${-weeks} weeks ago`;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------- grouping the same bucket across chains ----------

const FILLER = new Set(
  "a an and the of with in on for popcorn bucket buckets collectible collectibles container containers exclusive limited edition theater theaters version".split(" "),
);
const CHAIN_ORDER = Object.keys(CHAIN_COLORS);

function words(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

// Words that describe the design itself: no movie title, no filler.
function designWords(b) {
  const movie = new Set(words(b.movie));
  return words(b.design ?? b.name).filter((w) => !FILLER.has(w) && !movie.has(w));
}

function sameDesign(a, b) {
  if (a.movie !== b.movie) return false;
  if (a.design && b.design) return words(a.design).join("") === words(b.design).join("");
  const wa = designWords(a);
  const wb = designWords(b);
  if (!wa.length || !wb.length) return false;
  if (wa.join("") === wb.join("")) return true; // "fish bowl" == "fishbowl"
  const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return small.length >= 2 && small.every((w) => big.includes(w)); // "doctor doom statue" ⊂ "led doctor doom statue"
}

/** Merge items that are the same design at different chains into groups. */
function groupItems(items) {
  const groups = [];
  for (const b of items) {
    const g = groups.find((g) => !g.some((m) => m.chain === b.chain) && g.some((m) => sameDesign(m, b)));
    if (g) g.push(b);
    else groups.push([b]);
  }
  for (const g of groups) g.sort((a, b) => CHAIN_ORDER.indexOf(a.chain) - CHAIN_ORDER.indexOf(b.chain));
  return groups;
}

function card(group) {
  const first = group[0];
  const withImg = group.find((m) => m.image || m.imageUrl) ?? first;
  const pic = el("div", { class: "pic" });
  const sources = [withImg.image, withImg.imageUrl].filter(Boolean);
  if (sources.length) {
    const img = el("img", { src: sources[0], alt: `${first.movie} ${first.name}`, loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => {
      sources.shift();
      if (sources.length) img.src = sources[0];
      else img.replaceWith(el("span", { class: "ph" }, "🍿"));
    });
    pic.append(img);
    pic.addEventListener("click", () => openViewer(img.src, img.alt));
  } else {
    pic.append(el("span", { class: "ph" }, "🍿"));
  }
  pic.append(
    el(
      "div",
      { class: "badges" },
      group.map((m) => el("span", { class: "badge", style: `--chip:${chainColor(m.chain)}` }, m.chain)),
    ),
  );

  const facts = el("dl", { class: "facts" });
  // One line when every chain agrees, otherwise one line per chain.
  const fact = (label, valueOf, keyOf = valueOf) => {
    const rows = group.map((m) => [m.chain, valueOf(m), keyOf(m)]).filter(([, v]) => v);
    if (!rows.length) return;
    const distinct = new Set(rows.map(([, , k]) => JSON.stringify(k)));
    const dd =
      group.length === 1 || (distinct.size === 1 && rows.length === group.length)
        ? rows[0][1]
        : rows.map(([chain, v]) =>
            el("div", { class: "per-chain" }, el("b", { style: `color:${chainColor(chain)}` }, chain), " ", v),
          );
    facts.append(el("dt", {}, label), el("dd", {}, dd));
  };
  fact(
    "In theaters",
    (m) =>
      m.availableDate
        ? [fmt(m.availableDate), m.dateNote ? el("span", { class: "note" }, ` · ${m.dateNote}`) : null]
        : [el("span", { class: "tag" }, "not confirmed"), " ", m.dateNote ?? "Date TBA"],
    (m) => [m.availableDate, m.dateNote],
  );
  const movieDate = group.find((m) => m.movieReleaseDate)?.movieReleaseDate;
  if (movieDate) facts.append(el("dt", {}, "Movie opens"), el("dd", {}, fmt(movieDate, { month: "short", day: "numeric", year: "numeric" })));
  fact("Price", (m) => m.price);
  fact("How", (m) => m.purchaseNotes);

  const names = [...new Set(group.map((m) => m.name))];
  const allSources = [...new Set(group.flatMap((m) => m.sources ?? []))];
  return el(
    "article",
    { class: "card", id: first.id },
    group.slice(1).map((m) => el("span", { id: m.id, class: "anchor" })), // keep calendar links working
    pic,
    el(
      "div",
      { class: "body" },
      el("h3", { class: "movie" }, first.movie),
      el("p", { class: "name" }, names[0]),
      names.length > 1 && el("p", { class: "note" }, `Also listed as: ${names.slice(1).join(" · ")}`),
      facts,
      group.find((m) => m.description) && el("p", { class: "desc" }, group.find((m) => m.description).description),
      allSources.length > 0 &&
        el(
          "div",
          { class: "sources" },
          allSources.slice(0, 5).map((s) => el("a", { href: s, target: "_blank", rel: "noopener" }, hostOf(s))),
        ),
    ),
  );
}

function openViewer(src, alt) {
  const dlg = $("#viewer");
  const img = dlg.querySelector("img");
  img.src = src;
  img.alt = alt;
  dlg.showModal();
}

function section(title, rel, items, { now = false, collapsed = false } = {}) {
  const heading = el("h2", {}, title, rel && el("span", { class: "rel" }, rel), el("span", { class: "rel" }, `· ${items.length}`));
  const confirmed = (g) => (g.some((m) => m.availableDate) ? 1 : 0);
  const sorted = [...items].sort(
    (a, b) => confirmed(b) - confirmed(a) || a[0].movie.localeCompare(b[0].movie) || b.length - a.length,
  );
  const grid = el("div", { class: "grid" }, sorted.map(card));
  if (collapsed) {
    return el("details", { class: "week" }, el("summary", {}, heading), grid);
  }
  return el("section", { class: `week${now ? " now" : ""}` }, heading, grid);
}

function render() {
  const app = $("#app");
  app.replaceChildren();
  const today = isoLocal(new Date());
  const thisThu = weekThursday(today);
  const q = state.q.trim().toLowerCase();

  const items = state.data.buckets.filter(
    (b) =>
      (state.chain === "All" || b.chain === state.chain) &&
      (!q || `${b.movie} ${b.name} ${b.chain} ${b.description ?? ""}`.toLowerCase().includes(q)),
  );

  const byWeek = new Map();
  const tba = [];
  for (const g of groupItems(items)) {
    // Unconfirmed buckets almost always drop with the movie's opening week,
    // so file them there (flagged "not confirmed" on the card).
    const dates = g.map((m) => m.availableDate ?? m.movieReleaseDate).filter(Boolean).sort();
    const when = dates[0];
    const b = g;
    if (!when) {
      tba.push(b);
      continue;
    }
    const thu = weekThursday(when);
    if (!byWeek.has(thu)) byWeek.set(thu, []);
    byWeek.get(thu).push(b);
  }
  const weeks = [...byWeek.keys()].sort();
  const upcoming = weeks.filter((w) => w >= thisThu);
  const recent = weeks.filter((w) => w < thisThu && w >= addDays(thisThu, -RECENT_DAYS)).reverse();
  const older = weeks.filter((w) => w < addDays(thisThu, -RECENT_DAYS)).reverse();

  for (const w of upcoming) {
    app.append(section(`Week of ${fmt(w)}`, relWeeks(w, thisThu), byWeek.get(w), { now: w === thisThu }));
  }
  if (tba.length) app.append(section("Announced — date TBA", null, tba));
  for (const w of recent) {
    app.append(section(`Week of ${fmt(w)}`, relWeeks(w, thisThu), byWeek.get(w), { collapsed: true }));
  }
  if (older.length) {
    const all = older.flatMap((w) => byWeek.get(w));
    app.append(section("Archive", null, all, { collapsed: true }));
  }
  if (!app.children.length) app.append(el("p", { class: "empty" }, "Nothing matches yet."));
}

function renderChains() {
  const present = [...new Set(state.data.buckets.map((b) => b.chain))].sort((a, b) => {
    const order = Object.keys(CHAIN_COLORS);
    const ia = order.indexOf(a) < 0 ? 99 : order.indexOf(a);
    const ib = order.indexOf(b) < 0 ? 99 : order.indexOf(b);
    return ia - ib || a.localeCompare(b);
  });
  const box = $("#chains");
  box.replaceChildren(
    ...["All", ...present].map((c) =>
      el(
        "button",
        {
          class: "chip",
          type: "button",
          "aria-pressed": String(state.chain === c),
          style: c === "All" ? null : `--chip:${chainColor(c)}`,
          onclick: () => {
            state.chain = c;
            renderChains();
            render();
          },
        },
        c,
      ),
    ),
  );
}

async function init() {
  $("#viewer button").addEventListener("click", () => $("#viewer").close());
  $("#viewer").addEventListener("click", (e) => e.target === e.currentTarget && $("#viewer").close());
  $("#q").addEventListener("input", (e) => {
    state.q = e.target.value;
    render();
  });
  // webcal:// opens the "subscribe" flow on iOS/macOS instead of a one-time download.
  const cal = $("#cal");
  if (location.protocol === "https:") cal.href = new URL("buckets.ics", location.href).href.replace(/^https:/, "webcal:");

  try {
    const res = await fetch("buckets.json", { cache: "no-cache" });
    state.data = await res.json();
  } catch {
    $("#meta").textContent = "Couldn't load buckets.json";
    return;
  }
  const n = state.data.buckets.length;
  $("#meta").textContent = state.data.updatedAt
    ? `${n} buckets tracked · last checked ${new Date(state.data.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
    : `${n} buckets tracked`;
  renderChains();
  render();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

init();
