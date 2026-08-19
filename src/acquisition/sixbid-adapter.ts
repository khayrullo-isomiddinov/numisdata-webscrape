import type { SourceAdapter } from "./source-adapter.ts";
import { urlHostname } from "./source-adapter.ts";
import { acquireSixbidAuction, parseSixbidUrl } from "./sixbid-api.ts";
import { assertSafeSixbidUrl } from "./url-safety.ts";
import { parseSixbidAuction, parseSixbidLots } from "../extraction/sixbid-parser.ts";

const SIXBID_HOST_PATTERN = /(^|\.)sixbid\.com$/i;

/** Adapter wrapping the sixbid JSON-API acquisition/extraction pipeline. */
export const sixbidAdapter: SourceAdapter = {
  id: "sixbid",
  sourceDomain: "sixbid.com",

  matchesUrl(rawUrl) {
    const hostname = urlHostname(rawUrl);
    return hostname !== null && SIXBID_HOST_PATTERN.test(hostname);
  },

  assertSafeUrl: assertSafeSixbidUrl,

  parseAuctionIdentifier(rawUrl) {
    return parseSixbidUrl(rawUrl)?.auctionId ?? null;
  },

  acquire: acquireSixbidAuction,

  parseAuction: (firstPage, sourceUrl) => parseSixbidAuction(firstPage.html, sourceUrl),

  parseLots: (page) => parseSixbidLots(page.html),

  // sixbid's own auctionId numbers are an independent space from Biddr's - prefix so the two
  // sources can never collide under data/sources/auctions/<key>/.
  storageKey: (auctionIdentifier) => `sixbid-${auctionIdentifier}`,
};
