import { getDb } from "../../database/schema.ts";
import { AuctionRepository } from "../../database/repositories/auction-repository.ts";
import { LotRepository } from "../../database/repositories/lot-repository.ts";
import { ImageRepository } from "../../database/repositories/image-repository.ts";
import { AcquisitionRunRepository } from "../../database/repositories/acquisition-run-repository.ts";
import {
  acquireAuction,
  AcquisitionBlockedError,
  BrowserUnavailableError,
  RobotsDisallowedError,
  UnsafeUrlError,
  UnsupportedPageError,
} from "../../acquisition/acquisition-manager.ts";
import { assertSafeBiddrUrl } from "../../acquisition/url-safety.ts";
import { importLocalHtml, InvalidImportError } from "../../acquisition/local-file.ts";
import { loadSavedSource, saveSourcePages, sourceDirFor } from "../../acquisition/source-storage.ts";
import { parseAuction } from "../../extraction/auction-parser.ts";
import { parseLotListing } from "../../extraction/lot-parser.ts";
import { getQueryParam } from "../../extraction/parser-utils.ts";
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

interface PersistResult {
  auction: Auction;
  lotCount: number;
}

/** Exported for tests - not part of the public API surface used by controllers. */
export function persistPages(
  auctionUrl: string,
  pages: RawSource[],
  method: AcquisitionMethod,
  rawSourcePath: string | null,
): PersistResult {
  const { auctions, lots, images } = repos();
  const firstPage = pages[0]!;

  const extractedAuction = parseAuction({ html: firstPage.html, sourceUrl: auctionUrl });
  const auction = auctions.upsert(extractedAuction, { acquisitionMethod: method, rawSourcePath });
  const excluded = lots.listExcludedIdentifiers(auction.id);

  let lotCount = 0;
  for (const page of pages) {
    const extractedLots = parseLotListing(page.html, auctionUrl);
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
    return new IngestionError("Please provide a valid Biddr auction URL.", "invalid-url", { url });
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
  if (err instanceof UnsupportedPageError) {
    return new IngestionError(err.message, "unsupported", { url });
  }
  return new IngestionError("An unexpected error occurred while retrieving this auction.", "internal", {
    url,
    reason: err instanceof Error ? err.message : String(err),
  });
}

/** POST /api/acquisitions - "Retrieve": creates the auction if it doesn't exist; otherwise returns the existing one without hitting the network again. */
export async function retrieveAuction(url: string): Promise<PersistResult & { created: boolean }> {
  const { auctions } = repos();

  // Validate the URL up front, even on the dedupe fast path below - a malformed/non-Biddr URL
  // should always be rejected rather than silently matched against an unrelated existing auction.
  try {
    assertSafeBiddrUrl(url);
  } catch (err) {
    throw mapAcquisitionError(err, url);
  }

  const auctionIdentifier = getQueryParam(url, "a");
  if (auctionIdentifier) {
    const existing = auctions.findByIdentifier("biddr.com", auctionIdentifier);
    if (existing) {
      const lotCount = repos().lots.listForAuction(existing.id).length;
      return { auction: existing, lotCount, created: false };
    }
  }

  const runId = repos().runs.start(url, "http");
  try {
    const { auctionIdentifier: id, pages, method } = await acquireAuction(url);
    const { dir } = await saveSourcePages(
      id,
      pages.map((p, i) => ({ html: p.html, label: i === 0 ? "source" : `source-p${i + 1}` })),
      { originalUrl: url, acquisitionMethod: method, httpStatus: pages[0]!.httpStatus, contentType: pages[0]!.contentType },
    );
    const result = persistPages(url, pages, method, dir);
    repos().runs.complete(runId, { status: "success", rawFilePath: dir, auctionId: result.auction.id });
    return { ...result, created: true };
  } catch (err) {
    const mapped = mapAcquisitionError(err, url);
    repos().runs.complete(runId, {
      status: mapped.kind === "blocked" ? "blocked" : mapped.kind === "unsupported" ? "unsupported" : "failed",
      rawFilePath: null,
      auctionId: null,
      errorMessage: mapped.message,
    });
    throw mapped;
  }
}

/** POST /api/auctions/:id/refresh - re-fetches the source over the network and updates existing records. */
export async function refreshAuction(auctionId: number): Promise<PersistResult> {
  const { auctions } = repos();
  const existing = auctions.findById(auctionId);
  if (!existing) throw new IngestionError("Auction not found.", "not-found");

  const runId = repos().runs.start(existing.sourceUrl, "http");
  try {
    const { auctionIdentifier: id, pages, method } = await acquireAuction(existing.sourceUrl);
    const { dir } = await saveSourcePages(
      id,
      pages.map((p, i) => ({ html: p.html, label: i === 0 ? "source" : `source-p${i + 1}` })),
      { originalUrl: existing.sourceUrl, acquisitionMethod: method, httpStatus: pages[0]!.httpStatus, contentType: pages[0]!.contentType },
    );
    const result = persistPages(existing.sourceUrl, pages, method, dir);
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

  const saved = await loadSavedSource(existing.auctionIdentifier);
  if (!saved) {
    throw new IngestionError(
      "No saved source is available for this auction. Use Refresh to fetch it again first.",
      "not-found",
    );
  }

  const pages: RawSource[] = saved.pages.map((html, i) => ({
    html,
    finalUrl: existing.sourceUrl,
    httpStatus: saved.metadata.httpStatus ?? 0,
    contentType: saved.metadata.contentType,
  }));

  const runId = repos().runs.start(existing.sourceUrl, "local-file");
  try {
    const result = persistPages(existing.sourceUrl, pages, saved.metadata.acquisitionMethod, sourceDirFor(existing.auctionIdentifier));
    repos().runs.complete(runId, {
      status: "success",
      rawFilePath: sourceDirFor(existing.auctionIdentifier),
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

/** POST /api/import/local - Strategy C: parses a manually-saved HTML page (no network request). */
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
  const auctionIdentifier = getQueryParam(url, "a");
  if (!auctionIdentifier) {
    throw new IngestionError(
      "Could not determine the auction id from this page. Make sure you saved a Biddr auction catalogue page (URL containing ?a=...).",
      "invalid-import",
    );
  }

  const { auctions } = repos();
  const wasExisting = auctions.findByIdentifier("biddr.com", auctionIdentifier) !== null;

  const runId = repos().runs.start(url, "local-file");
  try {
    const { dir } = await saveSourcePages(auctionIdentifier, [{ html: source.html, label: "source" }], {
      originalUrl: url,
      acquisitionMethod: "local-file",
      httpStatus: null,
      contentType: "text/html",
    });
    const result = persistPages(url, [source], "local-file", dir);
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
