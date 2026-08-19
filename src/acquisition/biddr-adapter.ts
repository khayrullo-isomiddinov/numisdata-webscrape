import type { SourceAdapter } from "./source-adapter.ts";
import { urlHostname } from "./source-adapter.ts";
import { acquireAuction } from "./acquisition-manager.ts";
import { assertSafeBiddrUrl } from "./url-safety.ts";
import { getQueryParam } from "../extraction/parser-utils.ts";
import { parseAuction } from "../extraction/auction-parser.ts";
import { parseLotListing } from "../extraction/lot-parser.ts";

const BIDDR_HOST_PATTERN = /(^|\.)biddr\.com$/i;

/** Thin adapter wrapping the existing, unmodified Biddr acquisition/extraction pipeline. */
export const biddrAdapter: SourceAdapter = {
  id: "biddr",
  sourceDomain: "biddr.com",

  matchesUrl(rawUrl) {
    const hostname = urlHostname(rawUrl);
    return hostname !== null && BIDDR_HOST_PATTERN.test(hostname);
  },

  assertSafeUrl: assertSafeBiddrUrl,

  parseAuctionIdentifier(rawUrl) {
    return getQueryParam(rawUrl, "a");
  },

  acquire: acquireAuction,

  parseAuction: (firstPage, sourceUrl) => parseAuction({ html: firstPage.html, sourceUrl }),

  parseLots: (page, sourceUrl) => parseLotListing(page.html, sourceUrl),

  storageKey: (auctionIdentifier) => auctionIdentifier,
};
