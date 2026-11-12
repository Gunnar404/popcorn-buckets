# 🍿 Popcorn Bucket Drops

A dark-mode web page listing upcoming collectible popcorn buckets at AMC and Regal. Buckets are grouped by **theater week (Thursday → Wednesday)** and each one shows a picture, the chain, the date it goes on sale, when the movie opens, the price, and links to the sources.

Every other day a scheduled Claude Code session (on your Claude plan, no API key) searches the web for new and updated buckets and saves its findings to `findings/latest.json`. A GitHub Action then merges them, saves pictures, and republishes the site.

There's also a **calendar feed** (`buckets.ics`). If you subscribe to it from your phone, every bucket drop shows up as an all-day event with a reminder the evening before.

## How it works

| Step | Where | What happens |
|---|---|---|
| 1. Research | Scheduled Claude Code session, every other day | Follows [`RESEARCH.md`](RESEARCH.md): searches the web and reads the articles for AMC and Regal buckets, re-checks known ones, writes `findings/latest.json`, validates it with `scripts/check-findings.mjs`, and pushes. |
| 2. Merge | GitHub Action (`update.yml`), triggered by that push | Merges findings into `site/buckets.json`. Known items are updated, but a value is never replaced with "unknown". Excluded titles and other chains are dropped. |
| 3. Images | same Action | Downloads each item's photo into `site/images/`, falling back to the article's preview image. |
| 4. Publish | same Action | Commits `site/` and deploys it to GitHub Pages. `deploy.yml` also redeploys when the site code changes. |

If a bucket's on-sale date isn't announced yet, it goes in its movie's opening week and is marked **Date TBC**.

## Setup

- **Pages:** Settings → Pages → Source → **GitHub Actions** (already done).
- **Schedule:** the scheduled task lives in your Claude account (Claude Code → scheduled tasks), running in the "Popcorn" cloud environment. Pause or change its timing there.
- **No API key needed.** `ANTHROPIC_API_KEY` is only used if you run `npm run update` yourself (the older all-in-one API mode).
- **Manual refresh:** run the scheduled task from Claude, or Actions → *Popcorn bucket tracker* → **Run workflow** to re-merge the last findings and retry missing photos.

## Local use

```bash
npm install
npm test                                   # unit tests for merge/date/calendar logic
ANTHROPIC_API_KEY=sk-... npm run update    # optional: full refresh via the Claude API
node scripts/check-findings.mjs findings/latest.json  # validate findings
node scripts/update.mjs --images-only      # just retry missing pictures
node scripts/update.mjs --fixture found.json  # merge a saved JSON list without calling Claude
npm run serve                              # http://localhost:8080
```

You can tune the search window with the `LOOKBACK_DAYS` and `LOOKAHEAD_DAYS` env vars. The tracked chains are set in `KNOWN_CHAINS` in `scripts/lib.mjs`, and titles to always skip in `EXCLUDED_MOVIES`.

## Files

```
.github/workflows/update.yml   merge findings + Pages deploy
.github/workflows/deploy.yml   redeploy on site changes
RESEARCH.md          instructions for the scheduled research session
findings/latest.json latest research results
scripts/check-findings.mjs  validates findings before they're pushed
scripts/schema.mjs   shared schema for a found bucket
scripts/update.mjs   scheduled job (research → extract → merge → images → calendar)
scripts/lib.mjs      pure helpers (merge, Thursday weeks, og:image, .ics)
scripts/test.mjs     tests
site/                the static site that gets deployed
  index.html, app.js, style.css
  buckets.json       the data (source of truth)
  buckets.ics        calendar feed
  images/            downloaded bucket photos
```
