import { getDb } from "../../database/schema.ts";
import { AuctionRepository } from "../../database/repositories/auction-repository.ts";
import { LotRepository } from "../../database/repositories/lot-repository.ts";
import { ImageRepository } from "../../database/repositories/image-repository.ts";
import { AcquisitionRunRepository } from "../../database/repositories/acquisition-run-repository.ts";
import {
  AcquisitionBlockedError,
  BrowserUnavailableError,
  RobotsDisallowedError,
  UnsafeUrlError,
  UnsupportedPageError,
} from "../../acquisition/acquisition-manager.ts";
import { SixbidArchivedError } from "../../acquisition/sixbid-api.ts";
import { importLocalHtml, InvalidImportError } from "../../acquisition/local-file.ts";
import { loadSavedSource, saveSourcePages, sourceDirFor } from "../../acquisition/source-storage.ts";
import { biddrAdapter } from "../../acquisition/biddr-adapter.ts";
import { sixbidAdapter } from "../../acquisition/sixbid-adapter.ts";
import type { SourceAdapter } from "../../acquisition/source-adapter.ts";
import type { RawSource } from "../../acquisition/http.ts";
import type { Auction } from "../../domain/auction.ts";
import type { AcquisitionMethod } from "../../domain/image.ts";

export class IngestionError extends Error {
  constructor(
    message: string,
    public readonly kind: "invalid-url" | "blocked" | "unsupported" | "not-found" | "invalid-import" | "internal",
    public readonly diagnostic?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

function repos() {
  const db = getDb();
  return {
    db,
    auctions: new AuctionRepository(db),
    lots: new LotRepository(db),
    images: new ImageRepository(db),
    runs: new AcquisitionRunRepository(db),
  };
}

/** Every source this app knows how to acquire from, tried in order against a pasted URL. */
const ADAPTERS: SourceAdapter[] = [biddrAdapter, sixbidAdapter];

function selectAdapter(rawUrl: string): SourceAdapter {
  const adapter = ADAPTERS.find((a) => a.matchesUrl(rawUrl));
  if (!adapter) {
    throw new IngestionError("Please provide a valid Biddr or sixbid.com auction URL.", "invalid-url", { url: rawUrl });
  }
  return adapter;
}

interface PersistResult {
  auction: Auction;
  lotCount: number;
}

/** Exported for tests - not part of the public API surface used by controllers. */
export function persistPages(
  adapter: SourceAdapter,
  auctionUrl: string,
  pages: RawSource[],
  method: AcquisitionMethod,
  rawSourcePath: string | null,
): PersistResult {
  const { auctions, lots, images } = repos();
  const firstPage = pages[0]!;

  const extractedAuction = adapter.parseAuction(firstPage, auctionUrl);
  const auction = auctions.upsert(extractedAuction, { acquisitionMethod: method, rawSourcePath });
  const excluded = lots.listExcludedIdentifiers(auction.id);

  let lotCount = 0;
  for (const page of pages) {
    const extractedLots = adapter.parseLots(page, auctionUrl);
    for (const extractedLot of extractedLots) {
      // The user deliberately deleted this lot from the archive at some point - a Refresh or
      // Re-import re-parsing the same (or freshly re-fetched) listing must not bring it back.
      if (excluded.has(extractedLot.lotIdentifier)) continue;

      const lot = lots.upsert(auction.id, extractedLot);
      // A listing-page re-scrape only ever carries one thumbnail; never let it clobber a richer
      // image set a prior lot-detail fetch already established (mirrors mergeLot's text-field rule).
      if (extractedLot.images.length > 0 && extractedLot.images.length >= images.listForLot(lot.id).length) {
        images.replaceForLot(lot.id, extractedLot.images);
      }
      lotCount++;
    }
  }

  return { auction, lotCount };
}

function mapAcquisitionError(err: unknown, url: string): IngestionError {
  if (err instanceof UnsafeUrlError) {
    return new IngestionError("Please provide a valid Biddr or sixbid.com auction URL.", "invalid-url", { url });
  }
  if (err instanceof AcquisitionBlockedError || err instanceof RobotsDisallowedError) {
    return new IngestionError(
      "Automatic retrieval could not safely access this page. You can save the publicly accessible page locally and import it instead.",
      "blocked",
      { url, httpStatus: (err as AcquisitionBlockedError).httpStatus, reason: err.message },
    );
  }
  if (err instanceof BrowserUnavailableError) {
    return new IngestionError(
      "Automatic retrieval could not safely access this page. You can save the publicly accessible page locally and import it instead.",
      "blocked",
      { url, reason: err.message },
    );
  }
  if (err instanceof SixbidArchivedError) {
    return new IngestionError(err.message, "unsupported", { url });
  }
  if (err instanceof UnsupportedPageError) {
    return new IngestionError(err.message, "unsupported", { url });
  }
  return new IngestionError("An unexpected error occurred while retrieving this auction.", "internal", {
    url,
    reason: err instanceof Error ? err.message : String(err),
  });
}

export type StartRetrieveResult =
  | { kind: "existing"; auction: Auction; lotCount: number }
  | { kind: "started"; runId: number };

/**
 * POST /api/acquisitions - "Retrieve". If the auction already exists, returns it immediately
 * (no network). Otherwise starts the acquisition in the background and returns right away with a
 * runId - a multi-page sixbid/Biddr acquisition can take well over a minute (rate-limited to
 * ~3s/page), so the HTTP request doesn't block on it. Progress and the final result are reported
 * via the acquisition_runs row, polled through GET /api/acquisitions/:id
 * (see AcquisitionRunRepository.updateProgress and runAcquisitionInBackground below).
 */
export async function startRetrieveAuction(url: string): Promise<StartRetrieveResult> {
  const { auctions, runs } = repos();

  const adapter = selectAdapter(url);
  // Validate the URL up front, even on the dedupe fast path below - a malformed URL should
  // always be rejected rather than silently matched against an unrelated existing auction.
  try {
    adapter.assertSafeUrl(url);
  } catch (err) {
    throw mapAcquisitionError(err, url);
  }

  const auctionIdentifier = adapter.parseAuctionIdentifier(url);
  if (auctionIdentifier) {
    const existing = auctions.findByIdentifier(adapter.sourceDomain, auctionIdentifier);
    if (existing) {
      const lotCount = repos().lots.listForAuction(existing.id).length;
      return { kind: "existing", auction: existing, lotCount };
    }
  }

  const runId = runs.start(url, "http");
  // Deliberately not awaited - the acquisition run continues after this function returns; errors
  // are caught inside and written to the run row, not thrown here (there's no request left to
  // throw them to).
  runAcquisitionInBackground(adapter, url, runId).catch((err) => {
    console.error(`Unhandled error in background acquisition run ${runId}:`, err);
  });

  return { kind: "started", runId };
}

async function runAcquisitionInBackground(adapter: SourceAdapter, url: string, runId: number): Promise<void> {
  const { runs } = repos();
  try {
    const { auctionIdentifier: id, pages, method } = await adapter.acquire(url, (currentPage, totalPages) => {
      repos().runs.updateProgress(runId, currentPage, totalPages);
    });
    const { dir } = await saveSourcePages(
      adapter.storageKey(id),
      pages.map((p, i) => ({ html: p.html, label: i === 0 ? "source" : `source-p${i + 1}` })),
      { originalUrl: url, acquisitionMethod: method, httpStatus: pages[0]!.httpStatus, contentType: pages[0]!.contentType },
    );
    const result = persistPages(adapter, url, pages, method, dir);
    runs.complete(runId, { status: "success", rawFilePath: dir, auctionId: result.auction.id });
  } catch (err) {
    const mapped = mapAcquisitionError(err, url);
    runs.complete(runId, {
      status: mapped.kind === "blocked" ? "blocked" : mapped.kind === "unsupported" ? "unsupported" : "failed",
      rawFilePath: null,
      auctionId: null,
      errorMessage: mapped.message,
    });
  }
}

/** POST /api/auctions/:id/refresh - re-fetches the source over the network and updates existing records. */
export async function refreshAuction(auctionId: number): Promise<PersistResult> {
  const { auctions } = repos();
  const existing = auctions.findById(auctionId);
  if (!existing) throw new IngestionError("Auction not found.", "not-found");

  const adapter = selectAdapter(existing.sourceUrl);
  const runId = repos().runs.start(existing.sourceUrl, "http");
  try {
    const { auctionIdentifier: id, pages, method } = await adapter.acquire(existing.sourceUrl);
    const { dir } = await saveSourcePages(
      adapter.storageKey(id),
      pages.map((p, i) => ({ html: p.html, label: i === 0 ? "source" : `source-p${i + 1}` })),
      { originalUrl: existing.sourceUrl, acquisitionMethod: method, httpStatus: pages[0]!.httpStatus, contentType: pages[0]!.contentType },
    );
    const result = persistPages(adapter, existing.sourceUrl, pages, method, dir);
    repos().runs.complete(runId, { status: "success", rawFilePath: dir, auctionId: result.auction.id });
    return result;
  } catch (err) {
    const mapped = mapAcquisitionError(err, existing.sourceUrl);
    repos().runs.complete(runId, {
      status: mapped.kind === "blocked" ? "blocked" : mapped.kind === "unsupported" ? "unsupported" : "failed",
      rawFilePath: null,
      auctionId: existing.id,
      errorMessage: mapped.message,
    });
    throw mapped;
  }
}

/** POST /api/auctions/:id/reimport - re-runs extraction against the already-saved source, no network request. */
export async function reimportAuctionSource(auctionId: number): Promise<PersistResult> {
  const { auctions } = repos();
  const existing = auctions.findById(auctionId);
  if (!existing) throw new IngestionError("Auction not found.", "not-found");

  const adapter = selectAdapter(existing.sourceUrl);
  const storageKey = adapter.storageKey(existing.auctionIdentifier);

  const saved = await loadSavedSource(storageKey);
  if (!saved) {
    throw new IngestionError(
      "No saved source is available for this auction. Use Refresh to fetch it again first.",
      "not-found",
    );
  }

  const pages: RawSource[] = saved.pages.map((html) => ({
    html,
    finalUrl: existing.sourceUrl,
    httpStatus: saved.metadata.httpStatus ?? 0,
    contentType: saved.metadata.contentType,
  }));

  const runId = repos().runs.start(existing.sourceUrl, "local-file");
  try {
    const result = persistPages(adapter, existing.sourceUrl, pages, saved.metadata.acquisitionMethod, sourceDirFor(storageKey));
    repos().runs.complete(runId, {
      status: "success",
      rawFilePath: sourceDirFor(storageKey),
      auctionId: result.auction.id,
    });
    return result;
  } catch (err) {
    repos().runs.complete(runId, {
      status: "failed",
      rawFilePath: null,
      auctionId: existing.id,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new IngestionError("The saved source could not be re-parsed.", "internal", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/** POST /api/import/local - Strategy C: parses a manually-saved HTML page (no network request). Biddr only - see README. */
export async function importLocalAuctionPage(
  content: string,
  declaredSourceUrl: string | null,
): Promise<PersistResult & { created: boolean }> {
  let source;
  try {
    source = importLocalHtml(content, declaredSourceUrl);
  } catch (err) {
    if (err instanceof InvalidImportError) {
      throw new IngestionError(err.message, "invalid-import");
    }
    throw err;
  }

  const url = declaredSourceUrl ?? extractUrlFromOpenGraph(source.html) ?? source.finalUrl;
  const auctionIdentifier = biddrAdapter.parseAuctionIdentifier(url);
  if (!auctionIdentifier) {
    throw new IngestionError(
      "Could not determine the auction id from this page. Make sure you saved a Biddr auction catalogue page (URL containing ?a=...).",
      "invalid-import",
    );
  }

  const { auctions } = repos();
  const wasExisting = auctions.findByIdentifier(biddrAdapter.sourceDomain, auctionIdentifier) !== null;

  const runId = repos().runs.start(url, "local-file");
  try {
    const { dir } = await saveSourcePages(biddrAdapter.storageKey(auctionIdentifier), [{ html: source.html, label: "source" }], {
      originalUrl: url,
      acquisitionMethod: "local-file",
      httpStatus: null,
      contentType: "text/html",
    });
    const result = persistPages(biddrAdapter, url, [source], "local-file", dir);
    repos().runs.complete(runId, { status: "success", rawFilePath: dir, auctionId: result.auction.id });
    return { ...result, created: !wasExisting };
  } catch (err) {
    repos().runs.complete(runId, {
      status: "failed",
      rawFilePath: null,
      auctionId: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new IngestionError("The imported page's catalogue structure could not be recognized.", "unsupported", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

function extractUrlFromOpenGraph(html: string): string | null {
  const match = html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i);
  return match ? match[1]!.replace(/&amp;/g, "&") : null;
}
