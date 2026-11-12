// Run with: node scripts/test.mjs
import assert from "node:assert/strict";
import { buildIcs, bucketId, extractMetaImage, mergeBuckets, releaseWeekThursday, normalizeChain } from "./lib.mjs";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok - ${name}`); };

test("release week starts on Thursday", () => {
  assert.equal(releaseWeekThursday("2026-12-17"), "2026-12-17"); // Thu
  assert.equal(releaseWeekThursday("2026-12-18"), "2026-12-17"); // Fri
  assert.equal(releaseWeekThursday("2026-12-23"), "2026-12-17"); // Wed
  assert.equal(releaseWeekThursday("2026-12-24"), "2026-12-24"); // next Thu
});

test("chain names normalize", () => {
  assert.equal(normalizeChain("AMC Theatres"), "AMC");
  assert.equal(normalizeChain("regal cinemas"), "Regal");
  assert.equal(normalizeChain("Galaxy Theatres"), null);
  assert.equal(normalizeChain("Alamo Drafthouse Cinema"), null);
  assert.equal(normalizeChain("Marcus"), null);
  assert.equal(normalizeChain(null), null);
});

test("untracked chains are dropped, including previously stored ones", () => {
  const stored = [{ id: "marcus-x", movie: "X", name: "Y", chain: "Marcus", sources: [] }];
  const r = mergeBuckets(stored, [{ movie: "Z", name: "Tin", chain: "Harkins" }, { movie: "Z", name: "Tin", chain: "Regal" }], "t");
  assert.deepEqual(r.buckets.map((b) => b.chain), ["Regal"]);
  assert.equal(normalizeChain("Cinemark"), null);
});

test("excluded titles are dropped", () => {
  const stored = [{ id: "regal-heated", movie: "Heated Rivalry", name: "Combo", chain: "Regal", sources: [] }];
  const r = mergeBuckets(stored, [{ movie: "Batman Day 2026", name: "Batmobile", chain: "AMC" }], "t");
  assert.equal(r.buckets.length, 0);
});

const base = { movie: "Dune: Part Three", name: "Sandworm bucket", chain: "AMC", sources: ["https://a.example/1"] };

test("merge adds, then updates without erasing known values", () => {
  const r1 = mergeBuckets([], [{ ...base, price: "$40", availableDate: "2026-12-17" }], "t1");
  assert.equal(r1.added, 1);
  const id = r1.buckets[0].id;
  assert.equal(id, bucketId({ ...base }));

  const r2 = mergeBuckets(r1.buckets, [{ ...base, price: null, availableDate: "2026-12-16", sources: ["https://b.example/2"] }], "t2");
  assert.equal(r2.added, 0);
  assert.equal(r2.updated, 1);
  const b = r2.buckets[0];
  assert.equal(b.price, "$40", "null must not erase price");
  assert.equal(b.availableDate, "2026-12-16");
  assert.deepEqual(b.sources, ["https://a.example/1", "https://b.example/2"]);
  assert.equal(b.firstSeen, "t1");
  assert.equal(b.lastSeen, "t2");
});

test("merge honors existingId when the name drifts", () => {
  const r1 = mergeBuckets([], [base], "t1");
  const id = r1.buckets[0].id;
  const r2 = mergeBuckets(r1.buckets, [{ ...base, name: "Sandworm popcorn bucket", existingId: id }], "t2");
  assert.equal(r2.buckets.length, 1);
  assert.equal(r2.buckets[0].name, "Sandworm popcorn bucket");
});

test("merge drops junk and bad dates/urls", () => {
  const r = mergeBuckets([], [{ movie: "", name: "x", chain: "AMC" }, { ...base, availableDate: "Dec 17", imageUrl: "javascript:alert(1)", sources: ["not a url"] }], "t");
  assert.equal(r.buckets.length, 1);
  assert.equal(r.buckets[0].availableDate, null);
  assert.equal(r.buckets[0].imageUrl, null);
  assert.deepEqual(r.buckets[0].sources, []);
});

test("og:image extraction", () => {
  const html = `<head><meta content="/img/a.jpg?x=1&amp;y=2" property="og:image"><meta name="twitter:image" content="https://t/b.png"></head>`;
  assert.equal(extractMetaImage(html, "https://site.example/post"), "https://site.example/img/a.jpg?x=1&y=2");
  assert.equal(extractMetaImage("<p>none</p>", "https://x"), null);
});

test("ics feed has one event per dated bucket and folded lines", () => {
  const { buckets } = mergeBuckets([], [{ ...base, availableDate: "2026-12-17" }, { ...base, chain: "Regal" }], "t");
  const ics = buildIcs(buckets, "https://x.example/", "2026-11-11T00:00:00.000Z");
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
  assert.match(ics, /DTSTART;VALUE=DATE:20261217/);
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
});

console.log(`\n${n} tests passed`);
