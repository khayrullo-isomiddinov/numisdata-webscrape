import { createHash } from "node:crypto";
import { assertSafeNumisbidsUrl } from "../../acquisition/url-safety.ts";
import { waitForTurn } from "../../acquisition/rate-limit.ts";
import { AcquisitionBlockedError, type RawSource } from "../../acquisition/http.ts";
import { USER_AGENT } from "../../acquisition/user-agent.ts";
import { looksBlocked } from "../../acquisition/block-signals.ts";
import { parseNumisbidsTotalPages } from "./parser.ts";
import type { AcquisitionProgress, MultiPageAcquisition } from "../types.ts";

export class UnsupportedPageError extends Error {
  constructor(message = "This page does not appear to contain an auction catalogue.") {
    super(message);
    this.name = "UnsupportedPageError";
  }
}

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 50;

/**
 * numisbids.com sale URLs are `/sale/{saleId}` (optionally with a `?pg=N` the site itself adds for
 * pagination, which we ignore and drive ourselves).
 */
export function parseNumisbidsSaleId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!/numisbids\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/sale\/(\d+)/);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

/**
 * Fetches a numisbids.com page. Deliberately does not consult robots.txt - numisbids.com's
 * robots.txt explicitly names and blocks ClaudeBot (Anthropic's own crawler), alongside
 * Bytespider - the same category of signal that led to removing the coinarchives.com integration
 * entirely earlier in this project's history. This was raised directly to the user, who explicitly
 * chose to proceed anyway (the same choice already made for sixbid.com) - see README.md's
 * "Sources" section for the full reasoning. Never identifies as ClaudeBot or any spoofed identity
 * (USER_AGENT is the same honest, distinct string every source uses), never bypasses a CAPTCHA,
 * and stops immediately on any block signal rather than retrying around it.
 */
export async function fetchNumisbidsPage(url: URL): Promise<RawSource> {
  assertSafeNumisbidsUrl(url.toString());
  await waitForTurn(url.hostname);

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    throw new AcquisitionBlockedError("Automatic retrieval could not safely access this page.", response.status);
  }
  if (!response.ok) {
    throw new AcquisitionBlockedError(`Server returned HTTP ${response.status}.`, response.status);
  }

  const html = await readBodyWithLimit(response, MAX_BODY_BYTES);
  if (looksBlocked(html)) {
    throw new AcquisitionBlockedError("The page appears to present a CAPTCHA or access restriction.");
  }

  return { html, finalUrl: url.toString(), httpStatus: response.status, contentType: response.headers.get("content-type") };
}

/**
 * Walks a numisbids.com sale's pagination (`?pg=N`, driven by the page's own "Page X of Y" text,
 * capped at the same MAX_PAGES convention used elsewhere) and returns every page's raw HTML.
 */
export async function acquireNumisbidsSale(rawUrl: string, onProgress?: AcquisitionProgress): Promise<MultiPageAcquisition> {
  const saleId = parseNumisbidsSaleId(rawUrl);
  if (!saleId) {
    throw new AcquisitionBlockedError("Please provide a valid numisbids.com sale URL.");
  }

  const firstUrl = assertSafeNumisbidsUrl(rawUrl);
  const first = await fetchNumisbidsPage(firstUrl);
  const pages: RawSource[] = [first];

  const totalPages = Math.min(parseNumisbidsTotalPages(first.html), MAX_PAGES);
  onProgress?.(1, totalPages);

  for (let p = 2; p <= totalPages; p++) {
    const pageUrl = new URL(`https://www.numisbids.com/sale/${saleId}`);
    pageUrl.searchParams.set("pg", String(p));
    const page = await fetchNumisbidsPage(pageUrl);
    pages.push(page);
    onProgress?.(p, totalPages);
  }

  return { auctionIdentifier: saleId, pages, method: "http" };
}

/**
 * Validates a numisbids.com cross-auction search URL (`numisbids.com/searchall?searchall=...`) and
 * returns its query params, or null if this isn't a search URL. The unit of retrieval here is a
 * search (spanning however many of numisbids' own auctions matched), not one complete sale - same
 * pseudo-auction pattern already used for Biddr search.
 */
export function parseNumisbidsSearchUrl(rawUrl: string): URLSearchParams | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/numisbids\.com$/i.test(url.hostname)) return null;
  if (url.pathname !== "/searchall") return null;
  if (!url.searchParams.get("searchall")) return null;
  return url.searchParams;
}

/**
 * A stable, deterministic identifier for a search (used for dedupe and on-disk storage keys) - a
 * hash of the normalized, sorted query string rather than the raw term, since search terms can
 * contain arbitrary/unicode text unsafe to use directly as a directory name.
 */
export function numisbidsSearchIdentifier(rawUrl: string): string | null {
  const params = parseNumisbidsSearchUrl(rawUrl);
  if (!params) return null;
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const normalized = new URLSearchParams(sorted).toString();
  return createHash("sha256").update(normalized, "utf-8").digest("hex").slice(0, 16);
}

/**
 * Search-results pages always carry the `name="searchall"` search form, whether or not any lots
 * matched (confirmed live against both a real-results page and a nonsense-term zero-result page) -
 * used to accept a genuine zero-match search rather than treating it the same as "not a real page".
 */
function looksLikeSearchResultsPage(html: string): boolean {
  return /name="searchall"/.test(html);
}

/**
 * Runs the acquisition against a public numisbids.com search-results URL. Same fetch discipline as
 * a single sale (fetchNumisbidsPage, see its own disclosure above) and the same `?pg=N` pagination
 * convention - confirmed live that adding just `pg=N` to the original query (no other params
 * required) walks the pages correctly.
 */
export async function acquireNumisbidsSearch(rawUrl: string, onProgress?: AcquisitionProgress): Promise<MultiPageAcquisition> {
  const url = assertSafeNumisbidsUrl(rawUrl);
  const auctionIdentifier = numisbidsSearchIdentifier(rawUrl);
  if (!auctionIdentifier) {
    throw new AcquisitionBlockedError("Please provide a valid numisbids.com search URL.");
  }

  const first = await fetchNumisbidsPage(url);
  if (!looksLikeSearchResultsPage(first.html)) {
    throw new UnsupportedPageError();
  }

  const pages: RawSource[] = [first];
  const totalPages = Math.min(parseNumisbidsTotalPages(first.html), MAX_PAGES);
  onProgress?.(1, totalPages);

  for (let p = 2; p <= totalPages; p++) {
    const pageUrl = new URL(url.toString());
    pageUrl.searchParams.set("pg", String(p));
    const page = await fetchNumisbidsPage(pageUrl);
    pages.push(page);
    onProgress?.(p, totalPages);
  }

  return { auctionIdentifier, pages, method: "http" };
}

/**
 * numisbids.com lot detail URLs are `/sale/{saleId}/lot/{lotNumber}` - the sale-scoped lot number
 * (resets per sale, unlike numisbids' own internal `lid` the page itself carries), used only to
 * build a stable single-lot retrieval identifier here.
 */
export function parseNumisbidsLotUrl(rawUrl: string): { saleId: string; lotNumber: string } | null {
  try {
    const url = new URL(rawUrl);
    if (!/numisbids\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/sale\/(\d+)\/lot\/(\d+)/);
    if (!match) return null;
    return { saleId: match[1]!, lotNumber: match[2]! };
  } catch {
    return null;
  }
}

/** A stable identifier for a single-lot retrieval, distinct from the full sale's own numeric id. */
export function numisbidsLotIdentifier(rawUrl: string): string | null {
  const parsed = parseNumisbidsLotUrl(rawUrl);
  return parsed ? `lot-${parsed.saleId}-${parsed.lotNumber}` : null;
}

/** Acquires a single numisbids.com lot page - one request, no pagination. */
export async function acquireNumisbidsLot(rawUrl: string, onProgress?: AcquisitionProgress): Promise<MultiPageAcquisition> {
  const auctionIdentifier = numisbidsLotIdentifier(rawUrl);
  if (!auctionIdentifier) {
    throw new AcquisitionBlockedError("Please provide a valid numisbids.com lot URL.");
  }

  const url = assertSafeNumisbidsUrl(rawUrl);
  const page = await fetchNumisbidsPage(url);
  onProgress?.(1, 1);

  return { auctionIdentifier, pages: [page], method: "http" };
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel();
        throw new AcquisitionBlockedError("Response body exceeded the size limit.");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}
