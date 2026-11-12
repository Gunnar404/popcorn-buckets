// Pure helpers shared by update.mjs and the tests. No network, no filesystem.

// Only these chains are tracked; anything else is dropped.
export const KNOWN_CHAINS = ["AMC", "Regal"];

// Titles that aren't real bucket drops; never stored even if the search finds them again.
export const EXCLUDED_MOVIES = ["Heated Rivalry", "Batman Day"];

export function isExcludedMovie(movie) {
  const m = String(movie ?? "").toLowerCase();
  return EXCLUDED_MOVIES.some((x) => m.includes(x.toLowerCase()));
}

export function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function bucketId(b) {
  return slugify(`${b.chain}-${b.movie}-${b.name}`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function cleanDate(d) {
  if (typeof d !== "string" || !ISO_DATE.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? null : d;
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const t = Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000;
  return toISODate(new Date(t));
}

/** Thursday that starts the theater week (Thu..Wed) containing isoDate. */
export function releaseWeekThursday(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sun .. 4 Thu
  const back = (dow - 4 + 7) % 7;
  return addDays(isoDate, -back);
}

function cleanUrl(u) {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function cleanStr(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length ? t : null;
}

/** Map a chain name to one of KNOWN_CHAINS, or null if it isn't a tracked chain. */
export function normalizeChain(chain) {
  const c = cleanStr(chain);
  if (!c) return null;
  if (/^amc\b/i.test(c)) return "AMC";
  if (/^regal\b/i.test(c)) return "Regal";
  return null;
}

/** Normalize one bucket as returned by the model into the stored shape. */
export function normalizeIncoming(raw) {
  const b = {
    movie: cleanStr(raw.movie),
    name: cleanStr(raw.name),
    design: cleanStr(raw.design),
    chain: normalizeChain(raw.chain),
    availableDate: cleanDate(raw.availableDate),
    dateNote: cleanStr(raw.dateNote),
    movieReleaseDate: cleanDate(raw.movieReleaseDate),
    price: cleanStr(raw.price),
    purchaseNotes: cleanStr(raw.purchaseNotes),
    description: cleanStr(raw.description),
    kids: typeof raw.kids === "boolean" ? raw.kids : null,
    imageUrl: cleanUrl(raw.imageUrl),
    sources: [...new Set((raw.sources ?? []).map(cleanUrl).filter(Boolean))],
  };
  if (!b.movie || !b.name || !b.chain || isExcludedMovie(b.movie)) return null;
  return b;
}

/**
 * Merge freshly found buckets into the stored list.
 * - matches on existingId (model-supplied) first, then on the computed id
 * - never erases a known value with null (the model may simply not mention it)
 * - keeps firstSeen, bumps lastSeen
 */
export function mergeBuckets(existing, incoming, nowISO) {
  const byId = new Map(existing.map((b) => [b.id, { ...b }]));
  const touched = new Set();
  let added = 0;
  let updated = 0;

  for (const raw of incoming) {
    const b = normalizeIncoming(raw);
    if (!b) continue;
    const id =
      raw.existingId && byId.has(raw.existingId) ? raw.existingId : bucketId(b);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, {
        id,
        ...b,
        image: null,
        firstSeen: nowISO,
        lastSeen: nowISO,
      });
      added++;
    } else {
      const merged = { ...prev };
      let changed = false;
      for (const [k, v] of Object.entries(b)) {
        if (k === "sources") continue;
        if (v !== null && v !== prev[k]) {
          merged[k] = v;
          changed = true;
        }
      }
      // A re-check that explicitly reports the date as unconfirmed (no date, but a
      // note explaining why) withdraws a previously stored date. A bare null doesn't.
      if (raw.existingId === id && b.availableDate === null && b.dateNote && prev.availableDate) {
        merged.availableDate = null;
        changed = true;
      }
      const sources = [...new Set([...(prev.sources ?? []), ...b.sources])];
      if (sources.length !== (prev.sources ?? []).length) changed = true;
      merged.sources = sources;
      merged.lastSeen = nowISO;
      byId.set(id, merged);
      if (changed && !touched.has(id)) updated++;
    }
    touched.add(id);
  }

  // Drop anything stored earlier for chains that are no longer tracked.
  const buckets = [...byId.values()]
    .filter((b) => KNOWN_CHAINS.includes(b.chain) && !isExcludedMovie(b.movie))
    .sort(compareBuckets);
  return { buckets, added, updated };
}

export function compareBuckets(a, b) {
  const da = a.availableDate ?? "9999-12-31";
  const db = b.availableDate ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  if (a.movie !== b.movie) return a.movie < b.movie ? -1 : 1;
  return a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0;
}

/** Pull an og:image / twitter:image URL out of an HTML page. */
export function extractMetaImage(html, pageUrl) {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const wanted = ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"];
  const found = {};
  for (const tag of metas) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key && content && wanted.includes(key) && !found[key]) found[key] = content;
  }
  for (const k of wanted) {
    if (found[k]) {
      try {
        return new URL(decodeEntities(found[k]), pageUrl).href;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/");
}

export function extFromContentType(ct) {
  const t = (ct ?? "").split(";")[0].trim().toLowerCase();
  return (
    {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
    }[t] ?? null
  );
}

// ---------- iCalendar feed ----------

function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsFold(line) {
  // RFC 5545: lines max 75 octets; continuation lines start with a space.
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > 74) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function buildIcs(buckets, siteUrl, nowISO) {
  const stamp = nowISO.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//popcorn-buckets//tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Popcorn Bucket Drops",
    "X-PUBLISHED-TTL:PT12H",
  ];
  for (const b of buckets) {
    if (!b.availableDate) continue;
    const start = b.availableDate.replace(/-/g, "");
    const end = addDays(b.availableDate, 1).replace(/-/g, "");
    const desc = [
      b.description,
      b.price ? `Price: ${b.price}` : null,
      b.purchaseNotes,
      b.dateNote,
      b.movieReleaseDate ? `Movie opens ${b.movieReleaseDate}` : null,
      ...(b.sources ?? []).slice(0, 3),
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.id}@popcorn-buckets`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      icsFold(`SUMMARY:${icsEscape(`🍿 ${b.chain}: ${b.movie} — ${b.name}`)}`),
      icsFold(`DESCRIPTION:${icsEscape(desc)}`),
      ...(siteUrl ? [icsFold(`URL:${siteUrl}#${b.id}`)] : []),
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT15H",
      icsFold(`DESCRIPTION:${icsEscape(`${b.chain} ${b.movie} bucket drops tomorrow`)}`),
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
