# Numismatic Archive

A personal, local-first archive tool for public auction catalogues, currently
[Biddr](https://www.biddr.com), [sixbid.com](https://www.sixbid.com),
[jesusvico.com](https://www.jesusvico.com), [numisbids.com](https://www.numisbids.com), and
[aureo.com](https://www.aureo.com). Paste a public auction URL, it retrieves the page(s)
conservatively, extracts auction/lot metadata, and stores it in a local SQLite database with a
numismatic-catalogue-style UI.

This is a research/archive tool, not a scraping service — see "Sources" and "Legal/technical
principle" below. The sources are **not** held to identical standards - read both before assuming
one source's rules apply to another (sixbid.com and numisbids.com in particular are disclosed
exceptions to the robots.txt-respecting default; Biddr, jesusvico.com, and aureo.com are not).

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
URL → src/sources/<source>/ (acquire + parse) → Domain objects (src/domain)
    → SQLite repositories (src/database) → Web UI (src/ui)
```

`src/` is organized as one **feature folder per acquisition source**, plus shared layers
underneath that no single source owns:

- **`src/sources/`**: everything specific to one source lives together - `sources/biddr/`,
  `sources/sixbid/`, `sources/jesusvico/`, `sources/numisbids/`, `sources/aureo/`, each with its own
  `adapter.ts` (implements the `SourceAdapter` contract in `sources/types.ts`), its own acquisition
  logic, and its own parser(s). `sources/registry.ts` lists every adapter and picks the right one
  for a pasted URL - this is the only place that needs to know all five sources exist; everything
  else (`ingestion-service.ts`, `lot-detail-service.ts`) just asks the registry and drives whatever
  adapter comes back generically. Adding another source means adding another folder here and one
  line in the registry, not touching the sources that already work.
- **`src/acquisition/`**: shared, source-*agnostic* conservative-fetch infrastructure that more
  than one source's `adapter.ts` actually reuses - `http.ts` (`fetchPublicPage`, parameterized by
  source so every robots-respecting source shares one implementation rather than copies),
  `robots.ts`, `rate-limit.ts`, `block-signals.ts` (CAPTCHA/interstitial detection),
  `url-safety.ts` (every source's host allowlist lives here, deliberately centralized rather than
  split per-folder, so "every external host this app will ever contact" stays auditable in one
  place), `source-storage.ts`, `image-downloader.ts`, `local-file.ts`, `user-agent.ts`. sixbid's
  adapter (`sources/sixbid/api.ts`) and numisbids' (`sources/numisbids/acquisition.ts`) are the
  two places in the codebase that skip the robots.txt check - see "Sources" below.
- **`src/extraction/parser-utils.ts`**: the numismatic free-text heuristics (weight, material,
  denomination, ruler/date, price/date parsing in both Biddr's and jesusvico's conventions) that
  every source's parser reuses - the only thing left in `extraction/` once each source's own
  parser moved into its own `sources/<name>/` folder.
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

Each source has its own `src/sources/<name>/adapter.ts` implementing the `SourceAdapter` interface
(`src/sources/types.ts`); `src/sources/registry.ts` picks the matching adapter for a pasted URL,
and `ingestion-service.ts` drives Retrieve/Refresh/Re-import through it generically.

- **Biddr**: server-rendered HTML pages. See "Biddr acquisition strategy" below. Also supports a
  single-lot URL (`?a=...&l=...`, the exact page Biddr itself links to for one specific lot) as its
  own lightweight retrieval - a one-lot pseudo-auction, distinctly identified (`lot-<id>`) so it
  never collides with later retrieving that lot's full parent auction. Confirmed live that a lot
  not yet open for live bidding ("pre-bidding") renders its price in a plain `<b>` tag rather than
  the `.highlight-u` span every other observed state uses - `lot-parser.ts`'s price extraction
  matches either.
- **sixbid.com**: the page you paste is a client-rendered Vue SPA shell; the real data comes from
  a separate backing JSON API (`lots.sixbid.com/v2/{companySlug}/{auctionId}/`), fetched directly
  with plain `fetch()` — one call per page of lots, no browser needed. Unlike Biddr, that one call
  already returns full per-lot detail (no separate lot-detail-page fetch), and it's scoped to
  **live auctions only**; auctions that have moved to sixbid's separate, unvetted archive site are
  detected and reported rather than silently followed there. Also supports a single-lot URL
  (`/{house}/{auction}/{category}/{lotId}/{slug}`) as its own lightweight retrieval, backed by a
  second endpoint confirmed live (`lots.sixbid.com/v2/{companySlug}/{auctionId}/{lotId}/`) that
  returns the same fields a listing item has, just unwrapped - normalized to the same shape in
  `parser.ts` so no separate single-lot extraction logic was needed. This investigation also
  turned up a real, working per-lot page URL, previously left unconfirmed - every sixbid lot
  (not just single-lot retrievals) now gets a working "view original" link instead of none.

  **This one is honest to flag**: `lots.sixbid.com`'s `robots.txt` is a blanket `Disallow: /` for
  all crawlers (`www.sixbid.com`, the page a human browses, is separately permissive — but it
  serves no data itself). This app fetches from `lots.sixbid.com` anyway. That was a deliberate,
  informed choice, not an oversight: sixbid.com's Terms of Use (unlike Biddr's or acsearch.info's)
  don't reachably state a scraper prohibition, this is a personal cataloguing tool operating at
  low volume against publicly viewable auction data, and the choice was made explicitly rather
  than defaulted into. If that calculus changes, `src/sources/sixbid/api.ts` is the one place
  in this codebase that skips the robots.txt check — everything else (SSRF allowlisting, rate
  limiting, size/time bounds, archived-auction detection) still applies.
- **jesusvico.com**: a single auction house's own site, server-rendered HTML, `robots.txt` fully
  permissive - no exception needed, the simplest source integration so far. One auction URL is one
  complete, paginated listing (`?page=N`), same shape as Biddr's `?a=...&p=N`. Listing text is
  already complete (not truncated) but the detail page adds a real multi-image gallery the listing
  only shows one thumbnail of, so lot detail is still fetched **lazily, the first time you open
  that lot** - the same `fetchLotDetail`/`ensureLotDetail` mechanism Biddr uses (see below), now
  shared through `src/sources/registry.ts` rather than hardcoded to one source. Prices
  (`"6.000 €"`) and dates (`"02/07/2026"`) use European formatting conventions - parsed by
  `parseEuropeanPrice`/`parseEuropeanDateText` in `parser-utils.ts`, kept deliberately separate
  from Biddr's `parsePrice`/`parseBiddrDateText` since the two conventions are ambiguous against
  each other for round numbers. Also supports a single-lot URL (`/lot/` in English, `/lote/` in
  Spanish - both confirmed live) as its own lightweight retrieval; unlike Biddr/sixbid, a lot's own
  page carries no reusable auction-level header, so its pseudo-auction is honestly left with
  `status: "unknown"` rather than guessed. This also caught a real bug: the bare "X g. Y mm." weight
  pattern only handled a period decimal ("26.92 g.") - the Spanish locale's comma decimal ("6,75
  g.") wasn't just unmatched, it silently matched the *wrong* number ("75g" out of "6,75 g.",
  skipping the "6,") - both separators are now matched and normalized.
- **numisbids.com**: server-rendered HTML, listing + lazy per-lot detail fetch, the same shape as
  Biddr/jesusvico (`?pg=N` pagination). Each lot card carries numisbids' own stable internal `lid`
  (from its watchlist link), used as the lot identifier instead of the sale-scoped lot number,
  which resets per sale like jesusvico's does. Listing text is truncated; the detail page has the
  full description and a real multi-image gallery, fetched lazily the first time you open that lot.
  Price markup differs by sale state - an open sale shows "Starting price"; a closed one shows
  either "Price realized" or "Lot unsold" - and that presence/absence is itself the open/closed
  signal used for status, cross-checked against the sale's own dates. Also supports numisbids' own
  cross-auction search (`/searchall?searchall=...`), modeled as the same kind of honestly-labeled
  pseudo-auction as Biddr search - each result page groups lots under repeating `.salestatus`
  blocks (one per real matching auction), walked in document order to attach each lot's real
  originating auction into `category`, the same free facet-filter mechanism Biddr search already
  gives you. And a single-lot URL (`/sale/{id}/lot/{n}`) as its own lightweight retrieval - a lot's
  own page renders the identical `.salestatus` header a sale listing does, reused wholesale.

  This investigation also caught a real bug affecting every source, not just numisbids: large
  amounts (e.g. "250 000 USD") use a narrow no-break space as a thousands separator, which the
  shared `parsePrice` and numisbids' own price-extraction regex both silently misread as just
  "000" - both are now fixed (`stripDigitGroupingSpaces` in `parser-utils.ts`). It also caught a
  false-positive block detection: numisbids' Cloudflare-fronted pages routinely embed a background
  bot-management script whose own internal tokens contain the word "challenge" - a loose
  `cloudflare.*challenge` pattern in `block-signals.ts` fired on that, on an entirely successful
  page load. Replaced with the actual visible interstitial copy a real challenge page shows.

  **This one is also honest to flag**: numisbids.com's `robots.txt` explicitly names and blocks
  `ClaudeBot` (Anthropic's own crawler), alongside `Bytespider`. This app fetches from it anyway.
  That was a deliberate, informed choice, not an oversight - raised directly and explicitly chosen,
  the same as sixbid.com's exception above. If that calculus changes,
  `src/sources/numisbids/acquisition.ts` is the one other place in this codebase that skips the
  robots.txt check - everything else (SSRF allowlisting, rate limiting, size/time bounds, honest
  User-Agent, immediate stop on any block signal) still applies.
- **aureo.com**: `robots.txt` fully permissive - no exception needed, same as jesusvico.com. The
  auction page you paste (`/en/subasta/{id}`) ships with an empty lot list; the real data comes from
  the site's own AJAX endpoint (`/modules/loaditems.php`), POSTed to directly rather than driven by
  a browser - confirmed by reading the site's own `script.js`, the same "found the backing endpoint"
  approach as sixbid's JSON API, just POST+HTML instead of GET+JSON. Pagination is a "load more"
  button rather than numbered pages - walked by incrementing `pagina` until a response has none
  left. The listing card is already complete (full untruncated description, both starting price and
  hammer price once sold), and the full-resolution image URL is directly constructible from the
  auction id + lot number (`media.aureo.com/images/subastas/{auction}/{lot}.jpg`) - confirmed
  against the site's own image-viewer script - so there's no separate lot-detail fetch for this
  source. Grading uses the Spanish scale (`RC`/`BC`/`MBC`/`EBC`/`SC`, each optionally `+`/`-`),
  kept as its own `condition` value rather than translated to an English equivalent.

  A real bug: not every auction id is a plain 4-digit number - a multi-session auction's own id has
  a hyphenated session suffix (`0200-1`, confirmed live: `data-auction="0200-1"` is what the site's
  own AJAX calls use verbatim for a genuine 775-lot auction, not anything lot-scoped). The auction-
  id URL parser previously required plain digits only, silently rejecting this shape entirely -
  fixed to accept an optional `-N` suffix.

  Also supports aureo's own historical archive (`/en/precios/{brand}/{year}` - `brand` is `aureo`,
  `calico`, or `aureoandcalico`, the house's own sub-brands), which is **not** a filtered text
  search like Biddr/numisbids search: it's every auction that brand ran that year (confirmed live:
  9 auctions for `aureoandcalico/2026` alone). Modeled the same way regardless - one honestly-
  labeled pseudo-auction aggregating every lot from every one of those auctions, each tagged with
  its real originating auction via `category` - but this means fetching every lot from every listed
  auction, not a small matching subset, so it can mean hundreds of requests for a busy year. This
  was surfaced to the user directly before building it, who explicitly chose full aggregation over a
  lighter auction-index-only alternative; `MAX_AUCTIONS_PER_SEARCH` in
  `src/sources/aureo/acquisition.ts` caps it as a safety net.

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
- jesusvico.com's "unsold lot" price display (no realized price yet, auction still open) hasn't
  been observed against a live example - the one auction sampled during development was a fully
  completed historic sale where every lot had already sold. The parser is written to treat the
  realized-price block as optional rather than assuming it's always present, and this is covered
  by a synthetic (not live-sourced) test case, but worth a spot-check against a real open auction.
- jesusvico.com's `data-closed` auction-status attribute wasn't fully confirmed either - one
  sampled auction reported `data-closed="0"` despite every lot already being marked sold and its
  start date being in the past. `parseJesusvicoAuction` treats a past start date as authoritative
  over a `data-closed="0"` that contradicts it, as a safety net against that ambiguity.
- aureo.com renders Greek-alphabet inscriptions (common in ancient-coin legends) via a custom
  `Aureo Griego` font that remaps ordinary Latin characters to Greek glyphs visually, rather than
  using real Unicode Greek codepoints. The stored description text preserves exactly what the page
  sends, which means that portion reads as Latin-letter soup outside that font (e.g. "ºPYU([N]")
  rather than legible Greek - a real gap, not a parsing bug, and not one this app can close without
  a font glyph-mapping table.
- aureo.com's open/live auction presentation (an active bid form in place of a "Hammer price" line)
  wasn't observed against a live example - no auction was currently open during development, every
  sampled one had already closed with every lot showing a hammer price. `deriveAureoStatus` and the
  price-field handling are written to treat "Hammer price" as optional rather than assumed present
  (confirmed by reading the site's own `script.js`, which does swap in a bid form when absent), and
  this is covered by a synthetic (not live-sourced) test case, but worth a spot-check once a live
  auction is running.

## Legal/technical principle

Acquire only content you can already legitimately access via ordinary means; never bypass a
CAPTCHA, login wall, or rate limit. If automatic retrieval can't safely proceed, the app says so
and points you at the local-import fallback instead of trying harder.

Biddr and acsearch.info's Terms of Use explicitly forbid scrapers/bots - this app does not fetch
from acsearch.info at all, and never bypasses Biddr's robots.txt (see `robots.ts`). sixbid.com is
a deliberate, disclosed exception to the robots.txt half of this principle specifically - see
"Sources" above for why, and don't quietly extend that exception to any other site without the
same explicit reasoning.
