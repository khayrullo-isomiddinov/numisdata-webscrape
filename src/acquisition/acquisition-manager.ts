import { AcquisitionBlockedError, RobotsDisallowedError, fetchPublicPage, type RawSource } from "./http.ts";
import { BrowserUnavailableError, fetchRenderedPage } from "./browser.ts";
import { assertSafeBiddrUrl, UnsafeUrlError } from "./url-safety.ts";
import { parseTotalPages } from "../extraction/auction-parser.ts";
import { getQueryParam } from "../extraction/parser-utils.ts";
import type { AcquisitionMethod } from "../domain/image.ts";

export { UnsafeUrlError, AcquisitionBlockedError, RobotsDisallowedError, BrowserUnavailableError };

export class UnsupportedPageError extends Error {
  constructor(message = "This page does not appear to contain an auction catalogue.") {
    super(message);
    this.name = "UnsupportedPageError";
  }
}

export interface MultiPageAcquisition {
  auctionIdentifier: string;
  pages: RawSource[];
  method: AcquisitionMethod;
}

/** Called after each page is fetched, with the page just completed and the total known so far. */
export type AcquisitionProgress = (currentPage: number, totalPages: number) => void;

const MAX_PAGES = 50;

/** True when a page's HTML carries the markers we rely on for extraction. */
function looksLikeAuctionPage(html: string): boolean {
  return /class="catalog-title/.test(html) && (/class="catalog-lot/.test(html) || /class="catalog-grid/.test(html));
}

/**
 * Runs the acquisition fallback chain against a public Biddr auction URL: plain HTTP first, then
 * (only if the HTML looks client-rendered rather than blocked) a real local browser. A block
 * (CAPTCHA/auth wall/403/429) is never retried with the browser strategy - that would just be a
 * different way of trying to defeat the same restriction. Once page 1 is acquired, walks the
 * listing's own pagination to collect every page belonging to the auction, honoring the same
 * rate limiting as the first request.
 */
export async function acquireAuction(rawUrl: string, onProgress?: AcquisitionProgress): Promise<MultiPageAcquisition> {
  const url = assertSafeBiddrUrl(rawUrl);
  const auctionIdentifier = getQueryParam(url.toString(), "a");
  if (!auctionIdentifier) {
    throw new UnsafeUrlError("Please provide a valid Biddr auction URL (missing auction id).");
  }

  let first: RawSource;
  let method: AcquisitionMethod = "http";
  try {
    first = await fetchPublicPage(url.toString());
    if (!looksLikeAuctionPage(first.html)) {
      first = await fetchRenderedPage(url.toString());
      method = "browser";
    }
  } catch (err) {
    if (err instanceof AcquisitionBlockedError || err instanceof RobotsDisallowedError) {
      throw err; // Stop - do not attempt the browser strategy to work around a block.
    }
    throw err;
  }

  if (!looksLikeAuctionPage(first.html)) {
    throw new UnsupportedPageError();
  }

  const pages: RawSource[] = [first];
  const totalPages = Math.min(parseTotalPages(first.html), MAX_PAGES);
  onProgress?.(1, totalPages);

  for (let p = 2; p <= totalPages; p++) {
    const pageUrl = new URL(url.toString());
    pageUrl.searchParams.set("p", String(p));
    const page = method === "browser" ? await fetchRenderedPage(pageUrl.toString()) : await fetchPublicPage(pageUrl.toString());
    pages.push(page);
    onProgress?.(p, totalPages);
  }

  return { auctionIdentifier, pages, method };
}
