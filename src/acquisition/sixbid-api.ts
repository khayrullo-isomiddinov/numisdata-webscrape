import { assertSafeSixbidUrl } from "./url-safety.ts";
import { waitForTurn } from "./rate-limit.ts";
import { AcquisitionBlockedError, type RawSource } from "./http.ts";
import type { AcquisitionProgress, MultiPageAcquisition } from "./acquisition-manager.ts";

export const SIXBID_USER_AGENT = "PersonalNumismaticArchive/1.0 (+local personal research tool; conservative fetch rate)";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 50;

export class SixbidArchivedError extends Error {
  constructor(
    message = "This auction has moved to sixbid's separate coin-archive site, which this app does not fetch from.",
  ) {
    super(message);
    this.name = "SixbidArchivedError";
  }
}

/**
 * Parses a sixbid.com browser URL like
 * https://www.sixbid.com/en/heritage-auctions-inc/13977/page/1/perPage/100?... into the
 * companySlug + numeric auctionId the backing JSON API needs. Tolerates an optional 2-letter
 * locale prefix and ignores any trailing /page/N/perPage/N segments - pagination is driven by
 * our own loop against the API's own total_pages, not whatever page the user happened to be on.
 */
export function parseSixbidUrl(rawUrl: string): { companySlug: string; auctionId: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/sixbid\.com$/i.test(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const start = segments[0] && /^[a-z]{2}$/i.test(segments[0]) ? 1 : 0;
  const companySlug = segments[start];
  const auctionId = segments[start + 1];
  if (!companySlug || !auctionId || !/^\d+$/.test(auctionId)) return null;

  return { companySlug, auctionId };
}

interface SixbidApiResponse {
  success?: false;
  limit: number;
  current: number;
  total_pages: number;
  total_items: number;
  items: Record<string, unknown>[];
}

/**
 * Fetches one page of a sixbid auction's lots from the backing JSON API. Deliberately does not
 * consult robots.txt - lots.sixbid.com's robots.txt is a blanket "Disallow: /" for all agents
 * (confirmed live). This is a deliberate, informed exception: the user was asked directly and
 * chose to proceed, for their own personal cataloguing tool against public auction data with no
 * confirmed ToS prohibition (unlike biddr.com/acsearch.info's explicit anti-scraper ToS) - see
 * coins/README.md's "Sources" section. Every other conservative discipline still applies:
 * https-only host allowlist, SSRF checks, rate limiting, size/time bounds.
 */
async function fetchSixbidLotsPage(
  companySlug: string,
  auctionId: string,
  page: number,
): Promise<{ raw: RawSource; parsed: SixbidApiResponse }> {
  const apiUrl = new URL(`https://lots.sixbid.com/v2/${companySlug}/${auctionId}/`);
  apiUrl.searchParams.set("page", String(page));
  apiUrl.searchParams.set("orderCol", "lot_number");
  apiUrl.searchParams.set("orderDirection", "asc");
  apiUrl.searchParams.set("lang", "en");

  assertSafeSixbidUrl(apiUrl.toString());
  await waitForTurn(apiUrl.hostname);

  const response = await fetch(apiUrl, {
    headers: { "User-Agent": SIXBID_USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    throw new AcquisitionBlockedError("Automatic retrieval could not safely access this page.", response.status);
  }
  if (!response.ok) {
    throw new AcquisitionBlockedError(`Server returned HTTP ${response.status}.`, response.status);
  }

  const text = await readBodyWithLimit(response, MAX_BODY_BYTES);
  let parsed: SixbidApiResponse;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AcquisitionBlockedError("The sixbid API returned an unexpected response.");
  }

  if (parsed.success === false) {
    throw new SixbidArchivedError();
  }

  return {
    raw: {
      html: text,
      finalUrl: apiUrl.toString(),
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
    },
    parsed,
  };
}

/**
 * Walks a sixbid auction's pagination (driven by the API's own total_pages, capped at MAX_PAGES
 * like the Biddr equivalent in acquisition-manager.ts) and returns every page's raw JSON text,
 * ready for extraction and for source-storage.ts to persist unchanged (it just writes whatever
 * string it's given - it doesn't care whether it's HTML or JSON).
 */
export async function acquireSixbidAuction(rawUrl: string, onProgress?: AcquisitionProgress): Promise<MultiPageAcquisition> {
  const parsedUrl = parseSixbidUrl(rawUrl);
  if (!parsedUrl) {
    throw new AcquisitionBlockedError("Please provide a valid sixbid.com auction URL.");
  }
  const { companySlug, auctionId } = parsedUrl;

  const first = await fetchSixbidLotsPage(companySlug, auctionId, 1);
  const pages: RawSource[] = [first.raw];

  const totalPages = Math.min(first.parsed.total_pages, MAX_PAGES);
  onProgress?.(1, totalPages);

  for (let p = 2; p <= totalPages; p++) {
    const next = await fetchSixbidLotsPage(companySlug, auctionId, p);
    pages.push(next.raw);
    onProgress?.(p, totalPages);
  }

  return { auctionIdentifier: auctionId, pages, method: "http" };
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
