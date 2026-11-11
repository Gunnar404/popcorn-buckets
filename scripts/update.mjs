#!/usr/bin/env node
// Weekly popcorn-bucket update.
//
//   1. Research: Claude searches the web for collectible popcorn buckets
//      releasing at US theater chains around now (web_search + web_fetch).
//   2. Extract: a second call turns that research into strict JSON.
//   3. Merge into site/buckets.json, download images into site/images/,
//      and regenerate site/buckets.ics (subscribable calendar).
//
// Usage:
//   ANTHROPIC_API_KEY=... node scripts/update.mjs
//   node scripts/update.mjs --fixture path/to/found.json   # skip Claude, merge a saved result
//   node scripts/update.mjs --images-only                  # just backfill missing images
//
// Env:
//   ANTHROPIC_API_KEY  required unless --fixture / --images-only
//   SITE_URL           optional, used for links in the calendar feed
//   LOOKBACK_DAYS      default 14
//   LOOKAHEAD_DAYS     default 75

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  KNOWN_CHAINS,
  addDays,
  buildIcs,
  extFromContentType,
  extractMetaImage,
  mergeBuckets,
  toISODate,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(here, "../site");
const DATA_FILE = path.join(SITE_DIR, "buckets.json");
const ICS_FILE = path.join(SITE_DIR, "buckets.ics");
const IMAGE_DIR = path.join(SITE_DIR, "images");

const MODEL = "claude-opus-5-5";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const args = process.argv.slice(2);
const fixtureIdx = args.indexOf("--fixture");
const FIXTURE = fixtureIdx >= 0 ? args[fixtureIdx + 1] : null;
const IMAGES_ONLY = args.includes("--images-only");

// ---------- schema for the extraction step ----------

const BucketSchema = z.object({
  existingId: z
    .string()
    .nullable()
    .describe("id of the matching item from the KNOWN list, or null if this is new"),
  movie: z.string().describe("Movie title"),
  name: z
    .string()
    .describe("Short name of the collectible, e.g. 'Sandworm popcorn bucket' or 'Book tin'"),
  design: z
    .string()
    .nullable()
    .describe(
      "2-4 word canonical name of the physical design, written identically when the same bucket is sold at several chains (e.g. 'fish bowl', 'doctor doom statue', 'sandworm')",
    ),
  chain: z.string().describe(`Theater chain. One of: ${KNOWN_CHAINS.join(", ")}`),
  availableDate: z
    .string()
    .nullable()
    .describe("First day it can be bought in theaters, YYYY-MM-DD, or null if unannounced"),
  dateNote: z
    .string()
    .nullable()
    .describe("Caveats about the date, e.g. 'with Thursday previews', 'estimated', 'coming soon'"),
  movieReleaseDate: z.string().nullable().describe("Movie's US release date, YYYY-MM-DD"),
  price: z.string().nullable().describe("Price as stated, e.g. '$34.99 with large popcorn'"),
  purchaseNotes: z
    .string()
    .nullable()
    .describe("How to get it: in theater only, online/app pre-order, while supplies last, limit, etc."),
  description: z.string().nullable().describe("One or two sentences describing the design"),
  imageUrl: z
    .string()
    .nullable()
    .describe("Direct URL of a photo of this specific item (.jpg/.png/.webp), if one was found"),
  sources: z.array(z.string()).describe("URLs of pages that describe this item"),
});

const ResultSchema = z.object({ buckets: z.array(BucketSchema) });

// ---------- io helpers ----------

async function readData() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { updatedAt: null, buckets: [] };
    throw e;
  }
}

async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
}

// ---------- step 1: research ----------

function researchPrompt(today, known) {
  const from = addDays(today, -Number(process.env.LOOKBACK_DAYS ?? 14));
  const to = addDays(today, Number(process.env.LOOKAHEAD_DAYS ?? 75));
  const knownLines = known.length
    ? known
        .map(
          (b) =>
            `- [${b.id}] ${b.chain} | ${b.movie} | ${b.name} | available ${b.availableDate ?? "TBA"}`,
        )
        .join("\n")
    : "(none yet)";

  return `Today is ${today}. I track collectible popcorn buckets (and similar novelty popcorn containers such as tins, sculpted buckets, vehicle-shaped holders) sold at US movie theater chains: ${KNOWN_CHAINS.join(", ")}. Ignore every other chain.

Find every collectible popcorn bucket that goes on sale (or went on sale) between ${from} and ${to}, plus any already announced for later where the release date is known. New buckets usually go on sale on a Thursday, often with the movie's preview showings.

Search widely: chain announcements and social posts (AMC, Regal, Cinemark, Galaxy Theatres), and sites that cover this beat such as attractionsmagazine.com, hauntedattractionnetwork.com, comicbasics.com, mickeyvisit.com, allears.net, sporked.com, hollywoodlife.com, and r/popcornbuckets. Fetch the actual articles rather than relying on snippets. Ignore spam/SEO pages that only repeat a title.

For each distinct item (one entry per chain per design; if three chains sell different buckets for the same movie, that is three entries) record:
- movie, chain, short name of the item, and whether the same design is also sold at another chain
- date it is first available in theaters (YYYY-MM-DD) and any caveat (estimated, preview night, "coming soon")
- the movie's US release date
- price and how it's sold (with a large popcorn, online pre-order, in-theater only, while supplies last)
- one-line description of the design
- a DIRECT image URL showing that specific item, if any fetched page contains one (look for .jpg/.png/.webp links in the page)
- the source URLs you used

Items I already know about (re-check their dates and details; if one you find is the same item, refer to it by the id in brackets):
${knownLines}

Be precise with dates. Do not invent prices, dates, or image URLs — if something isn't stated, say it's unknown. Write the final report as a plain list, one item per paragraph, with the URLs written out in full.`;
}

async function research(client, today, known) {
  const messages = [{ role: "user", content: researchPrompt(today, known) }];
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: 25 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 25 },
  ];

  let final;
  for (let i = 0; i < 6; i++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      tools,
      messages,
    });
    final = await stream.finalMessage();
    console.log(
      `  research turn ${i + 1}: stop=${final.stop_reason} in=${final.usage.input_tokens} out=${final.usage.output_tokens}`,
    );
    if (final.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: final.content });
      continue;
    }
    break;
  }
  if (final.stop_reason === "refusal") throw new Error("Research request was refused");
  if (final.stop_reason === "pause_turn") throw new Error("Research did not finish after 6 continuations");

  // Collect the report text plus every URL Claude cited, so nothing is lost
  // between the research and extraction steps.
  const text = [];
  const cited = new Set();
  for (const msg of [...messages.filter((m) => m.role === "assistant"), final]) {
    for (const block of msg.content) {
      if (block.type !== "text") continue;
      text.push(block.text);
      for (const c of block.citations ?? []) if (c.url) cited.add(c.url);
    }
  }
  const report = text.join("");
  if (!report.trim()) throw new Error("Research returned no text");
  return cited.size ? `${report}\n\nCited URLs:\n${[...cited].join("\n")}` : report;
}

// ---------- step 2: extraction ----------

async function extract(client, today, known, report) {
  const knownIds = known.map((b) => `- ${b.id}: ${b.chain} | ${b.movie} | ${b.name}`).join("\n");
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: "low", format: zodOutputFormat(ResultSchema) },
    messages: [
      {
        role: "user",
        content: `Today is ${today}. Convert this research report on theater popcorn buckets into structured data. Only include items the report actually describes, and only for these chains: ${KNOWN_CHAINS.join(", ")}. Use null for anything not stated; never guess. Dates as YYYY-MM-DD. If an item matches one of these known ids, set existingId to it:\n${knownIds || "(none)"}\n\n<report>\n${report}\n</report>`,
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("Extraction request was refused");
  if (res.stop_reason === "max_tokens") throw new Error("Extraction hit max_tokens");
  if (!res.parsed_output) throw new Error("Extraction returned no parseable output");
  return res.parsed_output.buckets;
}

// ---------- images ----------

async function fetchWithTimeout(url, ms = 20000) {
  return fetch(url, {
    headers: { "user-agent": UA, accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(ms),
  });
}

async function tryDownload(url, id) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const ext = extFromContentType(res.headers.get("content-type"));
  if (!ext) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8_000 || buf.length > 10_000_000) return null; // skip icons/pixels and huge files
  const file = `${id}.${ext}`;
  await fs.writeFile(path.join(IMAGE_DIR, file), buf);
  return `images/${file}`;
}

async function metaImageFor(pageUrl) {
  try {
    const res = await fetchWithTimeout(pageUrl);
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    return extractMetaImage(await res.text(), res.url || pageUrl);
  } catch {
    return null;
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fillImages(buckets) {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  let got = 0;
  for (const b of buckets) {
    if (b.image && (await exists(path.join(SITE_DIR, b.image)))) continue;
    const candidates = [];
    if (b.imageUrl) candidates.push(b.imageUrl);
    for (const src of (b.sources ?? []).slice(0, 4)) {
      const og = await metaImageFor(src);
      if (og) candidates.push(og);
    }
    for (const url of [...new Set(candidates)]) {
      try {
        const local = await tryDownload(url, b.id);
        if (local) {
          b.image = local;
          if (!b.imageUrl) b.imageUrl = url;
          got++;
          break;
        }
      } catch {
        /* try the next candidate */
      }
    }
    if (!b.image) console.log(`  no image for ${b.id}`);
  }
  return got;
}

async function pruneImages(buckets) {
  const keep = new Set(buckets.map((b) => b.image).filter(Boolean).map((p) => path.basename(p)));
  let files = [];
  try {
    files = await fs.readdir(IMAGE_DIR);
  } catch {
    return;
  }
  for (const f of files) {
    if (f.startsWith(".") || keep.has(f)) continue;
    await fs.unlink(path.join(IMAGE_DIR, f));
  }
}

// ---------- main ----------

async function main() {
  const now = new Date();
  const nowISO = now.toISOString();
  const today = toISODate(now);
  const data = await readData();

  let added = 0;
  let updated = 0;
  let buckets = data.buckets;

  if (!IMAGES_ONLY) {
    let found;
    if (FIXTURE) {
      console.log(`Using fixture ${FIXTURE}`);
      const raw = JSON.parse(await fs.readFile(FIXTURE, "utf8"));
      found = Array.isArray(raw) ? raw : raw.buckets;
    } else {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY is not set (add it as a repository secret).");
        process.exit(1);
      }
      const client = new Anthropic({ timeout: 30 * 60 * 1000 });
      console.log(`Researching buckets around ${today} ...`);
      const report = await research(client, today, buckets);
      console.log("Extracting structured data ...");
      found = await extract(client, today, buckets, report);
    }
    console.log(`Found ${found.length} items`);
    ({ buckets, added, updated } = mergeBuckets(buckets, found, nowISO));
  }

  buckets = buckets.filter((b) => KNOWN_CHAINS.includes(b.chain));
  await pruneImages(buckets);

  console.log("Fetching images ...");
  const images = await fillImages(buckets);

  const out = { updatedAt: IMAGES_ONLY ? data.updatedAt : nowISO, buckets };
  await writeData(out);
  await fs.writeFile(ICS_FILE, buildIcs(buckets, process.env.SITE_URL ?? "", nowISO));

  const summary = `Popcorn buckets: ${added} new, ${updated} updated, ${images} images downloaded, ${buckets.length} total.`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const upcoming = buckets
      .filter((b) => b.availableDate && b.availableDate >= today)
      .slice(0, 25)
      .map((b) => `| ${b.availableDate} | ${b.chain} | ${b.movie} | ${b.name} |`)
      .join("\n");
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### ${summary}\n\n| Available | Chain | Movie | Item |\n|---|---|---|---|\n${upcoming}\n`,
    );
  }
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) console.error("Anthropic API key was rejected.");
  else if (err instanceof Anthropic.RateLimitError) console.error("Rate limited by the Anthropic API.");
  else if (err instanceof Anthropic.APIError) console.error(`Anthropic API error ${err.status}: ${err.message}`);
  else console.error(err);
  process.exit(1);
});
