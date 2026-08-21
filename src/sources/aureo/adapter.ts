import type { SourceAdapter } from "../types.ts";
import { urlHostname } from "../types.ts";
import { acquireAureoAuction, acquireAureoSearch, aureoSearchIdentifier, parseAureoAuctionId } from "./acquisition.ts";
import { assertSafeAureoUrl } from "../../acquisition/url-safety.ts";
import { parseAureoAuction, parseAureoLots, parseAureoSearchAuction, parseAureoSearchLots } from "./parser.ts";

const AUREO_HOST_PATTERN = /(^|\.)aureo\.com$/i;

/**
 * Adapter for aureo.com - both a normal auction URL (`/en/subasta/{id}`) and a historical-archive
 * search URL (`/en/precios/{brand}/{year}`) are handled by this one adapter, same domain, mirroring
 * how Biddr's and numisbids' adapters handle their own search URLs alongside normal auctions. Each
 * method tries the search path first and falls back to the auction-id path. Fully respects
 * robots.txt (permissive here, `Allow: /`) - no exception needed, unlike sixbid/numisbids. No
 * `fetchLotDetail` - unlike Biddr/jesusvico/numisbids, aureo's listing card already carries the
 * full untruncated description and a directly-constructible full-resolution image URL, confirmed
 * live, so there's nothing a separate detail fetch would add.
 */
export const aureoAdapter: SourceAdapter = {
  id: "aureo",
  sourceDomain: "aureo.com",

  matchesUrl(rawUrl) {
    const hostname = urlHostname(rawUrl);
    return hostname !== null && AUREO_HOST_PATTERN.test(hostname);
  },

  assertSafeUrl: assertSafeAureoUrl,

  parseAuctionIdentifier(rawUrl) {
    return aureoSearchIdentifier(rawUrl) ?? parseAureoAuctionId(rawUrl);
  },

  acquire: (rawUrl, onProgress) => (aureoSearchIdentifier(rawUrl) ? acquireAureoSearch(rawUrl, onProgress) : acquireAureoAuction(rawUrl, onProgress)),

  parseAuction: (firstPage, sourceUrl) =>
    aureoSearchIdentifier(sourceUrl) ? parseAureoSearchAuction(firstPage.html, sourceUrl) : parseAureoAuction(firstPage.html, sourceUrl),

  parseLots: (page, sourceUrl) => (aureoSearchIdentifier(sourceUrl) ? parseAureoSearchLots(page.html, sourceUrl) : parseAureoLots(page.html, sourceUrl)),

  // aureo's own auction ids are usually a plain integer, but a multi-session auction's id has a
  // hyphenated session suffix ("0200-1", confirmed live) - both are still a real auction id, an
  // independent space from every other source's, so both get the plain "aureo-" prefix; a search's
  // brand-year identifier (e.g. "aureoandcalico-2026", starting with letters) can't collide with
  // either shape, but gets the same explicit "-search-" marker as Biddr/numisbids for consistency.
  storageKey: (auctionIdentifier) => (/^\d+(-\d+)?$/.test(auctionIdentifier) ? `aureo-${auctionIdentifier}` : `aureo-search-${auctionIdentifier}`),
};
