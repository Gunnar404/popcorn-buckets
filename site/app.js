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

function card(b) {
  const color = chainColor(b.chain);
  const pic = el("div", { class: "pic", style: `--chip:${color}` });
  const sources = [b.image, b.imageUrl].filter(Boolean);
  if (sources.length) {
    const img = el("img", { src: sources[0], alt: `${b.movie} ${b.name}`, loading: "lazy", referrerpolicy: "no-referrer" });
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
  pic.append(el("span", { class: "badge" }, b.chain));

  const facts = el("dl", { class: "facts" });
  const fact = (k, v) => v && facts.append(el("dt", {}, k), el("dd", {}, v));
  fact(
    "In theaters",
    b.availableDate
      ? [fmt(b.availableDate), b.dateNote ? el("span", { class: "note" }, ` · ${b.dateNote}`) : null]
      : [el("span", { class: "tag" }, "not confirmed"), " ", b.dateNote ?? "Date TBA"],
  );
  fact("Movie opens", b.movieReleaseDate ? fmt(b.movieReleaseDate, { month: "short", day: "numeric", year: "numeric" }) : null);
  fact("Price", b.price);
  fact("How", b.purchaseNotes);

  return el(
    "article",
    { class: "card", id: b.id, style: `--chip:${color}` },
    pic,
    el(
      "div",
      { class: "body" },
      el("h3", { class: "movie" }, b.movie),
      el("p", { class: "name" }, b.name),
      facts,
      b.description && el("p", { class: "desc" }, b.description),
      (b.sources ?? []).length > 0 &&
        el(
          "div",
          { class: "sources" },
          b.sources.slice(0, 4).map((s) => el("a", { href: s, target: "_blank", rel: "noopener" }, hostOf(s))),
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
  const sorted = [...items].sort(
    (a, b) => (b.availableDate ? 1 : 0) - (a.availableDate ? 1 : 0) || a.movie.localeCompare(b.movie) || a.chain.localeCompare(b.chain),
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
  for (const b of items) {
    // Unconfirmed buckets almost always drop with the movie's opening week,
    // so file them there (flagged "not confirmed" on the card).
    const when = b.availableDate ?? b.movieReleaseDate;
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
