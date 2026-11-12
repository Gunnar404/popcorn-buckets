#!/usr/bin/env node
// Validate a findings file before it's committed:
//   node scripts/check-findings.mjs findings/latest.json
// Prints what would change on the site, without writing anything.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ResultSchema } from "./schema.mjs";
import { cleanDate, mergeBuckets, normalizeIncoming } from "./lib.mjs";

const file = process.argv[2] ?? "findings/latest.json";
const here = path.dirname(fileURLToPath(import.meta.url));
let raw;
try {
  raw = JSON.parse(await fs.readFile(file, "utf8"));
} catch (e) {
  console.error(`✗ ${file} is not readable JSON: ${e.message}`);
  process.exit(1);
}
const parsed = ResultSchema.safeParse(raw);
if (!parsed.success) {
  console.error(`✗ ${file} does not match the schema:`);
  for (const issue of parsed.error.issues.slice(0, 20)) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

const problems = [];
parsed.data.buckets.forEach((b, i) => {
  const where = `buckets[${i}] (${b.chain} ${b.movie} — ${b.name})`;
  if (!normalizeIncoming(b)) problems.push(`${where}: dropped (untracked chain, excluded title, or missing movie/name)`);
  for (const k of ["availableDate", "movieReleaseDate"])
    if (b[k] !== null && !cleanDate(b[k])) problems.push(`${where}: ${k} "${b[k]}" is not YYYY-MM-DD`);
  if (!b.sources.length) problems.push(`${where}: no sources`);
});

const site = JSON.parse(await fs.readFile(path.join(here, "../site/buckets.json"), "utf8"));
const { added, updated, buckets } = mergeBuckets(site.buckets, parsed.data.buckets, new Date().toISOString());
for (const p of problems) console.log(`! ${p}`);
console.log(`✓ ${file}: ${parsed.data.buckets.length} items → ${added} new, ${updated} updated, ${buckets.length} total after merge`);
