# Architecture

Short technical reference for programmers. For source-by-source scraping details and legal/ethics
notes, see [README.md](README.md).

## Pipeline

```
URL → sources/<name>/adapter.ts (acquire + parse) → ExtractedAuction / ExtractedLot / ExtractedImage
    → database/repositories (SQLite, upsert/merge)  → web/ REST API → ui/ (React)
```

Every source (Biddr, sixbid.com, jesusvico.com, numisbids.com, aureo.com) implements the same
`SourceAdapter` interface (`src/sources/types.ts`):

```ts
interface SourceAdapter {
  matchesUrl(rawUrl: string): boolean;
  assertSafeUrl(rawUrl: string): URL;
  parseAuctionIdentifier(rawUrl: string): string | null;
  acquire(rawUrl: string, onProgress?): Promise<MultiPageAcquisition>; // fetches raw HTML/JSON
  parseAuction(firstPage, sourceUrl): ExtractedAuction;
  parseLots(page, sourceUrl): ExtractedLot[];
  storageKey(auctionIdentifier: string): string;
  fetchLotDetail?(lotSourceUrl: string): Promise<ExtractedLot | null>; // lazy, on-demand
}
```

`sources/registry.ts` picks the matching adapter for a pasted URL. `ingestion-service.ts`
(`src/web/services/`) drives any adapter generically — nothing else needs to know a specific
source exists.

## The stable contract

`Extracted*` (`src/domain/{auction,lot,image}.ts`) is the normalized shape every source parses
into, **before** anything touches SQLite. This is the seam to build on for any external
integration — it's already source-agnostic.

```ts
interface ExtractedAuction {
  sourceUrl: string; sourceDomain: string; auctionIdentifier: string;
  auctionHouse: string | null; title: string | null; auctionNumber: string | null;
  description: string | null; location: string | null;
  startDate: string | null; endDate: string | null; status: "upcoming"|"live"|"closed"|"unknown";
  lotCount: number | null;
  categories: Array<{ id: string; name: string; count: number | null }>;
  raw: Record<string, unknown>; // whatever the source exposes but we don't model yet
}

interface ExtractedLot {
  sourceUrl: string | null; lotIdentifier: string; lotNumber: string | null;
  title: string | null; description: string | null; descriptionHtml: string | null;
  category: string | null;
  estimateLow: number | null; estimateHigh: number | null;
  startingPrice: number | null; realizedPrice: number | null; currency: string | null;
  weight: string | null; diameter: string | null; material: string | null; mint: string | null;
  ruler: string | null; denomination: string | null; datePeriod: string | null;
  condition: string | null; referenceNumber: string | null;
  detailFetched: boolean; // false = listing card only, true = full detail page
  images: ExtractedImage[];
  raw: Record<string, unknown>;
}

interface ExtractedImage { sourceUrl: string; order: number; width: number|null; height: number|null; }
```

**Important caveat for a researcher-facing tool**: `weight`/`diameter`/`material`/`ruler`/
`denomination`/`datePeriod` are best-effort regex heuristics run against free-text cataloguer
descriptions — not structured, IDed, or normalized against any numismatic authority (RIC, Krause,
etc.). `category`/`mint` are frequently `null` (not exposed by several sources' public markup).
The original text always survives in `description`/`raw`, so nothing is lost, but don't treat the
structured fields as ground truth without a review step.

## Persistence layer

`src/database/repositories/` — plain `bun:sqlite`, one migration
(`src/database/migrations/0001_init.sql`). `AuctionRepository.upsert` / `LotRepository.upsert`
**merge** re-scraped data onto existing rows rather than overwrite — a richer previous value
(e.g. a fetched lot-detail description) survives a later listing-only refresh that would otherwise
return `null` for that field.

Images are two-tier: every `ExtractedImage.sourceUrl` gets an `images` row immediately (so
thumbnails render, hot-linked from the source site); actual bytes are only pulled to
`data/images/<lotId>/` on an explicit user action (`image-downloader.ts`), never automatically —
see README's "Known limitations" for why (source images may carry usage restrictions).

## REST surface (today's integration point)

```
POST   /api/acquisitions          { url } → { status: "complete", auctionId } | { status: "in-progress", runId }
GET    /api/acquisitions/:runId   → poll progress until completedAt is set
GET    /api/auctions/:id          → { auction, lots: [...], facets }   ← full normalized record
DELETE /api/auctions/:id          → deletes DB rows + raw snapshot + downloaded images
POST   /api/auctions/:id/refresh
POST   /api/auctions/:id/reimport
POST   /api/import/local          → parse an uploaded saved HTML page, no network
```

`GET /api/auctions/:id` is already "paste a URL, get back one clean JSON document" — auction
metadata + every lot, images included. This is the fastest path to a Dedalo integration.

## Integrating with Dedalo

Goal: a researcher pastes a URL, the record lands in Dedalo's own DB, no manual re-entry.

**Recommended: thin connector, no changes to this repo's core.**
Have Dedalo's backend (or a small bridge service) call this app's REST API:

1. `POST /api/acquisitions` with the pasted URL.
2. Poll `GET /api/acquisitions/:runId` until it completes.
3. `GET /api/auctions/:id` for the full `{ auction, lots }` JSON.
4. Map `ExtractedAuction`/`ExtractedLot` fields onto Dedalo's ontology/DB and insert.

This keeps all scraping/parsing/rate-limiting/robots.txt logic in one place (this repo already
handles per-source quirks — see README's "Sources" section) and Dedalo only needs a mapping
function, not a scraper. Run this app as a small always-on local service; it's already a single
`bun index.ts` process with no external dependencies beyond the SQLite file.

**Alternative: direct integration.** Skip this app's own SQLite and call a source's `adapter.ts`
directly from Dedalo's own codebase (`acquire()` → `parseAuction()`/`parseLots()`), writing
straight into Dedalo's DB instead of `database/repositories/`. Gives Dedalo full control over
merge/dedupe semantics, at the cost of duplicating what `ingestion-service.ts` already does
(progress tracking, error mapping, dedupe-by-identifier, lazy lot-detail fetch). Only worth it if
Dedalo needs acquisition behavior this app's REST API can't express.

Either way, the adapter/parser layer (`src/sources/`) is the reusable part; `src/database/` and
`src/ui/` are this app's own local-archive concerns and don't need to be involved.
