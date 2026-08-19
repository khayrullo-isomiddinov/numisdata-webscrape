# Numismatic Archive

A personal, local-first archive tool for public auction catalogues, currently
[Biddr](https://www.biddr.com) and [sixbid.com](https://www.sixbid.com). Paste a public auction
URL, it retrieves the page conservatively, extracts auction/lot metadata, and stores it in a
local SQLite database with a numismatic-catalogue-style UI.

This is a research/archive tool, not a scraping service — see "Sources" and "Legal/technical
principle" below (the two sources are held to different standards; read both before assuming
either one's rules apply to the other).

## Run it

```bash
bun install
bun run dev
```

Then open http://localhost:3000. The database lives at `./data/archive.sqlite`; acquired raw
sources at `./data/sources/auctions/<auction_id>/`; any locally-archived images at
`./data/images/`. All of `data/` is gitignored — it's your local archive, not part of the repo.

```bash
bun test          # parser/repository tests, run entirely against saved HTML fixtures (no network)
bun run start      # production mode (no HMR)
```

## How it works

```
URL → Acquisition (src/acquisition) → Raw HTML → Extraction (src/extraction)
    → Domain objects (src/domain) → SQLite repositories (src/database) → Web UI (src/ui)
```

- **Acquisition** (`src/acquisition/`): a conservative HTTP client (`http.ts`) that respects
  robots.txt, rate-limits to Biddr's own `Crawl-delay`, validates URLs against SSRF (https-only,
  per-source host allowlists, private-IP checks on every redirect hop), and stops immediately on
  any sign of a CAPTCHA/block rather than retrying around it. `browser.ts` is an optional
  Playwright fallback for client-rendered pages (not currently needed for Biddr - see below).
  `local-file.ts` wraps a browser-saved HTML upload into the same shape. sixbid.com's JSON-API
  client (`sixbid-api.ts`) is the one exception to the robots.txt rule - see "Sources" below.
- **Extraction** (`src/extraction/`) doesn't care where the HTML came from. Biddr auction/lot
  pages are server-rendered HTML with stable class names (`.catalog-title`, `.catalog-lot`,
  `.lot-price`, ...) - there's no JSON-LD or embedded app-state JSON for auction/lot data
  (verified against live fixtures), so parsing is CSS-selector-based against those stable
  classes, with regex heuristics (`parser-utils.ts`) for numismatic fields (weight, material,
  denomination, ruler/date) that Biddr only exposes as free text.
- **Database** (`src/database/`): plain `bun:sqlite`, one migration file, FTS5 for full-text
  search. Repositories merge re-scraped data onto existing rows without downgrading previously
  richer data (e.g. a lot-detail fetch's full description/images survive a later listing-only
  refresh).
- **Web** (`src/web/`): `Bun.serve()` routes → controllers → services (`ingestion-service.ts`
  ties acquisition+extraction+persistence together; `lot-detail-service.ts` does the lazy
  per-lot detail fetch described below).
- **UI** (`src/ui/`): React via Bun's HTML import + bundler, hand-written CSS (no framework),
  a ~40-line client-side router (three routes don't need a router library).

## Sources

Each source has its own `src/acquisition/*-adapter.ts` implementing a small `SourceAdapter`
interface (`src/acquisition/source-adapter.ts`); `ingestion-service.ts` picks the matching
adapter for a pasted URL and drives Retrieve/Refresh/Re-import through it generically.

- **Biddr**: server-rendered HTML pages. See "Biddr acquisition strategy" below.
- **sixbid.com**: the page you paste is a client-rendered Vue SPA shell; the real data comes from
  a separate backing JSON API (`lots.sixbid.com/v2/{companySlug}/{auctionId}/`), fetched directly
  with plain `fetch()` — one call per page of lots, no browser needed. Unlike Biddr, that one call
  already returns full per-lot detail (no separate lot-detail-page fetch), and it's scoped to
  **live auctions only**; auctions that have moved to sixbid's separate, unvetted archive site are
  detected and reported rather than silently followed there.

  **This one is honest to flag**: `lots.sixbid.com`'s `robots.txt` is a blanket `Disallow: /` for
  all crawlers (`www.sixbid.com`, the page a human browses, is separately permissive — but it
  serves no data itself). This app fetches from `lots.sixbid.com` anyway. That was a deliberate,
  informed choice, not an oversight: sixbid.com's Terms of Use (unlike Biddr's or acsearch.info's)
  don't reachably state a scraper prohibition, this is a personal cataloguing tool operating at
  low volume against publicly viewable auction data, and the choice was made explicitly rather
  than defaulted into. If that calculus changes, `src/acquisition/sixbid-api.ts` is the one place
  in this codebase that skips the robots.txt check — everything else (SSRF allowlisting, rate
  limiting, size/time bounds, archived-auction detection) still applies.

## Biddr acquisition strategy

1. **HTTP** (`Strategy A`): plain `fetch()` with an identifiable User-Agent. This is sufficient
   for Biddr — auction/lot catalogue pages are fully present in the initial HTML response, not
   client-rendered.
2. **Browser** (`Strategy B`, Playwright): only attempted if the HTML from (1) doesn't contain
   the expected catalogue markers, as a normal-browser-behaving fallback for the (currently
   unobserved) case of client-rendered content. It is *never* used to retry a page that (1)
   already identified as blocked/CAPTCHA'd — a block is not something either strategy attempts
   to defeat.
3. **Local file import** (`Strategy C`): upload a browser-saved HTML page; parsed by the exact
   same extraction code, no network request. This is the answer whenever (1)/(2) can't safely
   proceed. Content arrives as upload bytes, not a server-side file path, so there's no path to
   traverse.

Listing pages (`?a=...&p=N`) give every lot's number, title, one thumbnail, and price, which is
enough to populate the catalogue grid for an entire auction in a handful of requests. Full
per-lot detail (weight, composition, untruncated description, full image carousel) only exists
on each lot's own page — fetching all of those up front for a 300-lot auction would mean
hundreds of extra requests, which conflicts with "don't aggressively crawl Biddr". Instead, lot
detail is fetched **lazily, the first time you open that lot**, and persisted from then on
(`ensureLotDetail` in `lot-detail-service.ts`).

`Retrieve` (dedupes by `source_domain + auction_identifier`, no re-fetch if it already exists),
`Refresh` (re-fetches and merges), and `Re-import source` (re-parses the already-saved HTML, no
network) are distinct actions/endpoints, matching the spec's semantics.

## Known limitations

- **Category / mint** are not reliably extractable from Biddr's public markup (category requires
  per-category listing crawls we don't do by default; mint has no structured field anywhere) -
  left `null` when not discoverable rather than guessed. `ruler`/`date period`/`denomination`
  are best-effort regex heuristics against cataloguer free text and can occasionally miss or
  mis-tag unusual phrasing; the full original text is always preserved in `description`/
  `raw_data_json` regardless.
- Playwright's browser binaries aren't downloaded automatically (`bun add playwright` only
  fetches the JS package) - run `bunx playwright install chromium` if Strategy B is ever
  actually needed.
- Image downloading (Mode 2) is per-image and user-triggered only, never automatic/bulk, since
  Biddr images may carry usage restrictions the archive shouldn't assume you want to keep.
- No auth/multi-user concerns - this is a single local SQLite file for one person's archive.

## Legal/technical principle

Acquire only content you can already legitimately access via ordinary means; never bypass a
CAPTCHA, login wall, or rate limit. If automatic retrieval can't safely proceed, the app says so
and points you at the local-import fallback instead of trying harder.

Biddr and acsearch.info's Terms of Use explicitly forbid scrapers/bots - this app does not fetch
from acsearch.info at all, and never bypasses Biddr's robots.txt (see `robots.ts`). sixbid.com is
a deliberate, disclosed exception to the robots.txt half of this principle specifically - see
"Sources" above for why, and don't quietly extend that exception to any other site without the
same explicit reasoning.
