import type { SourceAdapter } from "../types.ts";
import { urlHostname } from "../types.ts";
import {
  acquireNumisbidsLot,
  acquireNumisbidsSale,
  acquireNumisbidsSearch,
  fetchNumisbidsPage,
  numisbidsLotIdentifier,
  numisbidsSearchIdentifier,
  parseNumisbidsSaleId,
} from "./acquisition.ts";
import { assertSafeNumisbidsUrl } from "../../acquisition/url-safety.ts";
import {
  parseNumisbidsAuction,
  parseNumisbidsLotDetail,
  parseNumisbidsLots,
  parseNumisbidsSearchAuction,
  parseNumisbidsSearchLots,
  parseNumisbidsSingleLotAuction,
} from "./parser.ts";

const NUMISBIDS_HOST_PATTERN = /(^|\.)numisbids\.com$/i;

/**
 * Adapter for numisbids.com - a normal sale URL (`/sale/{id}`), a cross-auction search URL
 * (`/searchall?searchall=...`), and a single-lot URL (`/sale/{id}/lot/{n}`) are all handled by this
 * one adapter (same domain, same robots.txt/rate-limit exception) rather than separate adapters for
 * the same sourceDomain, mirroring how Biddr's adapter handles its own search URLs alongside normal
 * auctions. Each method checks search, then single-lot, then falls back to the sale-id path -
 * single-lot URLs also match the plain `/^\/sale\/(\d+)/` sale-id regex, so that check must come
 * before the full-sale fallback. Does NOT respect robots.txt (it explicitly blocks ClaudeBot) - see
 * sources/numisbids/acquisition.ts's fetchNumisbidsPage for the full disclosure, same exception
 * category as sixbid.
 */
export const numisbidsAdapter: SourceAdapter = {
  id: "numisbids",
  sourceDomain: "numisbids.com",

  matchesUrl(rawUrl) {
    const hostname = urlHostname(rawUrl);
    return hostname !== null && NUMISBIDS_HOST_PATTERN.test(hostname);
  },

  assertSafeUrl: assertSafeNumisbidsUrl,

  parseAuctionIdentifier(rawUrl) {
    return numisbidsSearchIdentifier(rawUrl) ?? numisbidsLotIdentifier(rawUrl) ?? parseNumisbidsSaleId(rawUrl);
  },

  acquire: (rawUrl, onProgress) => {
    if (numisbidsSearchIdentifier(rawUrl)) return acquireNumisbidsSearch(rawUrl, onProgress);
    if (numisbidsLotIdentifier(rawUrl)) return acquireNumisbidsLot(rawUrl, onProgress);
    return acquireNumisbidsSale(rawUrl, onProgress);
  },

  parseAuction: (firstPage, sourceUrl) => {
    if (numisbidsSearchIdentifier(sourceUrl)) return parseNumisbidsSearchAuction(firstPage.html, sourceUrl);
    if (numisbidsLotIdentifier(sourceUrl)) return parseNumisbidsSingleLotAuction(firstPage.html, sourceUrl);
    return parseNumisbidsAuction(firstPage.html, sourceUrl);
  },

  parseLots: (page, sourceUrl) => {
    if (numisbidsSearchIdentifier(sourceUrl)) return parseNumisbidsSearchLots(page.html, sourceUrl);
    if (numisbidsLotIdentifier(sourceUrl)) {
      const lot = parseNumisbidsLotDetail(page.html, sourceUrl);
      return lot ? [lot] : [];
    }
    return parseNumisbidsLots(page.html, sourceUrl);
  },

  // A real sale's numeric identifier gets the plain "numisbids-" prefix; a search's hash-shaped
  // identifier and a single-lot's "lot-<sale>-<lot>" identifier both fall into the non-numeric
  // branch - neither could ever collide with a plain digit string, so one shared prefix is enough.
  storageKey: (auctionIdentifier) => (/^\d+$/.test(auctionIdentifier) ? `numisbids-${auctionIdentifier}` : `numisbids-search-${auctionIdentifier}`),

  async fetchLotDetail(lotSourceUrl) {
    const url = assertSafeNumisbidsUrl(lotSourceUrl);
    const raw = await fetchNumisbidsPage(url);
    return parseNumisbidsLotDetail(raw.html, lotSourceUrl);
  },
};
