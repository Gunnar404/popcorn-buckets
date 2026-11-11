# 🍿 Popcorn Bucket Drops

A dark-mode web page listing upcoming collectible popcorn buckets at AMC, Regal, Cinemark, and Galaxy Theatres. Buckets are grouped by **theater week (Thursday → Wednesday)** and each one shows a picture, the chain, the date it goes on sale, when the movie opens, the price, and links to the sources.

Every Monday a GitHub Action has Claude search the web for new and updated buckets, saves pictures, commits the data, and republishes the site.

There's also a **calendar feed** (`buckets.ics`). If you subscribe to it from your phone, every bucket drop shows up as an all-day event with a reminder the evening before.

## How it works

| Step | What happens |
|---|---|
| 1. Research | `scripts/update.mjs` asks Claude (web search + fetch) for buckets going on sale from 2 weeks ago to ~75 days ahead, and gives it the list of buckets it already knows so it can re-check their dates. |
| 2. Extract | A second call turns the research report into strict JSON (structured outputs). |
| 3. Merge | New items are added. Known items are updated, but a value is never replaced with "unknown". |
| 4. Images | The script downloads each item's photo into `site/images/`. If there's no direct photo, it uses the source article's `og:image`. Local copies keep working even when sites block hotlinking. |
| 5. Publish | `site/buckets.json` and `site/buckets.ics` are committed, and `site/` is deployed to GitHub Pages. |

If a bucket's on-sale date isn't announced yet, it goes in its movie's opening week and is marked **not confirmed**.

## One-time setup

1. **Add your API key.** Go to Settings → Secrets and variables → Actions → New repository secret, name it `ANTHROPIC_API_KEY`, and paste a key from console.anthropic.com.
2. **Turn on Pages.** Go to Settings → Pages → Build and deployment → Source and choose **GitHub Actions**.
3. **Run it once now.** Go to Actions → *Popcorn bucket tracker* → **Run workflow**.

The site will be at `https://<user>.github.io/popcorn-buckets/`. Pages on a private repo requires a paid GitHub plan, so keep the repo public.

**Cost:** one Claude run per week with up to 25 searches and 25 page fetches. That's typically a dollar or two per run.

## Local use

```bash
npm install
npm test                                   # unit tests for merge/date/calendar logic
ANTHROPIC_API_KEY=sk-... npm run update    # full refresh
node scripts/update.mjs --images-only      # just retry missing pictures
node scripts/update.mjs --fixture found.json  # merge a saved JSON list without calling Claude
npm run serve                              # http://localhost:8080
```

You can tune the search window with the `LOOKBACK_DAYS` and `LOOKAHEAD_DAYS` env vars. The tracked chains are set in `KNOWN_CHAINS` in `scripts/lib.mjs`.

## Files

```
.github/workflows/update.yml   Monday schedule + Pages deploy
scripts/update.mjs   weekly job (research → extract → merge → images → calendar)
scripts/lib.mjs      pure helpers (merge, Thursday weeks, og:image, .ics)
scripts/test.mjs     tests
site/                the static site that gets deployed
  index.html, app.js, style.css
  buckets.json       the data (source of truth)
  buckets.ics        calendar feed
  images/            downloaded bucket photos
```
