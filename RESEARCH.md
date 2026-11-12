# Bucket research run

You are the scheduled research step for this site. Your job is to find collectible popcorn buckets and save what you find to `findings/latest.json`. A GitHub Action picks up that file, merges it into `site/buckets.json`, downloads photos and publishes the site. Don't edit anything under `site/` yourself.

## 1. What to look for

- **Chains:** AMC and Regal only (US). Ignore every other chain.
- **Items:** collectible popcorn buckets and similar novelty popcorn containers: tins, sculpted buckets, vehicle- or character-shaped holders, and "collectible combo" buckets.
- **Window:** anything going on sale from **14 days ago to 75 days ahead**, plus anything already announced for later with a known date.
- **Only movie tie-ins:** a bucket must be tied to a movie's theater release. Skip one-day events (e.g. Batman Day), TV or streaming tie-ins, and the titles in `EXCLUDED_MOVIES` in `scripts/lib.mjs`.
- **Timing:** new buckets usually go on sale on a Thursday with the movie's preview showings, sometimes a day or two earlier.

## 2. Where to look

Search the web, then **open and read the actual articles**. Don't rely on search snippets. Good sources:

- AMC and Regal's own sites and social posts (amctheatres.com, regmovies.com)
- attractionsmagazine.com, hauntedattractionnetwork.com, fantasylandnews.com, comicbasics.com, mickeyvisit.com, allears.net, sporked.com, hollywoodlife.com, r/popcornbuckets

Ignore spam/SEO pages that only repeat a title.

## 3. Re-check what's already known

Read `site/buckets.json`. For AMC/Regal items that are upcoming or have no confirmed date, look for updates: an announced date, price, or a better photo. If something you find is the same item as a known one, set `existingId` to that item's `id`.

## 4. Write `findings/latest.json`

Overwrite the file with everything you found or re-confirmed this run:

```json
{
  "buckets": [
    {
      "existingId": "regal-dune-part-three-spacing-guild-navigator-bucket",
      "movie": "Dune: Part Three",
      "name": "Spacing Guild Navigator bucket",
      "design": "navigator",
      "chain": "Regal",
      "availableDate": "2026-12-17",
      "dateNote": "with Thursday previews",
      "movieReleaseDate": "2026-12-18",
      "price": "$34.99 with large popcorn",
      "purchaseNotes": "In theaters, while supplies last",
      "description": "Sculpted Spacing Guild Navigator tank.",
      "imageUrl": "https://example.com/navigator.jpg",
      "sources": ["https://example.com/article"]
    }
  ]
}
```

Rules for the fields:
- **Every field must be present.** Use `null` when something isn't stated, and `[]` for `sources` only if you truly have none.
- **One entry per chain per design.** If AMC and Regal sell the same design, make two entries with the same `design` text.
- **Dates:** `YYYY-MM-DD`. Never guess a date, price or image URL. If an article says "coming soon", use `null` and put that in `dateNote`.
- **Withdrawing a wrong date:** for a known item (`existingId` set), `availableDate: null` *with* a `dateNote` explaining why (e.g. "December; exact date not announced") removes the date stored on the site. `null` with no `dateNote` leaves the stored date alone, so only do this when sources really don't give a date.
- **`imageUrl`:** a direct `.jpg`/`.png`/`.webp` link to a photo of that specific item, if an article contains one. Otherwise `null`; the Action will fall back to the article's preview image.

## 5. Check, commit, push

```bash
npm ci
node scripts/check-findings.mjs findings/latest.json   # must print ✓
git add findings/latest.json
git commit -m "Bucket research $(date -u +%F)"
git pull --rebase origin main
git push origin main
```

If the check prints `✗`, fix the file and run it again. Lines starting with `!` are warnings: fix them if they're real mistakes.

Finish with a short summary of what's new or changed since the last run.
