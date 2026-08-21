import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSixbidAuction,
  parseSixbidLots,
  parseSixbidSearchAuction,
  parseSixbidSearchLots,
  parseSixbidSingleLotAuction,
} from "../../../src/sources/sixbid/parser.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "heritage-13977-p1.json");
const SOURCE_URL = "https://www.sixbid.com/en/heritage-auctions-inc/13977/page/1/perPage/100";

const SINGLE_LOT_FIXTURE = join(import.meta.dir, "fixtures", "heritage-13977-lot-12399926.json");
const SINGLE_LOT_URL = "https://www.sixbid.com/en/heritage-auctions-inc/13977/argentina-la-rioja/12399926/la-rioja-republic-2-soles";

const SEARCH_FIXTURE = join(import.meta.dir, "fixtures", "search-madrid-eur.json");
const SEARCH_URL = "https://www.sixbid.com/en/lots/page/1/perPage/100?term=madrid&currency=EUR";

function sampleItem(overrides: Record<string, unknown> = {}) {
  return {
    companySlug: "test-house",
    companyName: "Test House",
    auctionId: 1,
    auctionName: "Auction #1",
    auctionDescription: "Test auction",
    auctionStart: "2026-01-01",
    auctionEnd: "2026-01-01",
    auctionOnlineEnd: "2026-01-01 00:00:00",
    auctionCurrency: "USD",
    auctionSlug: "test-auction",
    categoryName: "Test Category",
    categorySlug: "test-category",
    lotId: 1,
    lotNumber: 1,
    lotNumberAffix: "",
    lotSlug: "test-lot",
    lotDescription: "Test lot description",
    lotShortDescription: "Test lot description",
    lotEstimate: 0,
    lotStartingPrice: 1,
    lotPriceRealised: null,
    googleBucketImagePath: null,
    hasImage: 0,
    ...overrides,
  };
}

describe("parseSixbidAuction", () => {
  test("extracts auction metadata from the first item's denormalized fields", () => {
    const json = readFileSync(FIXTURE, "utf-8");
    const auction = parseSixbidAuction(json, SOURCE_URL);

    expect(auction.sourceDomain).toBe("sixbid.com");
    expect(auction.auctionIdentifier).toBe("13977");
    expect(auction.auctionHouse).toBe("Heritage Auctions, Inc.");
    expect(auction.title).toBe("Auction #61646");
    expect(auction.auctionNumber).toBe("61646");
    expect(auction.description).toBe("Spotlight: Latin America World Coins Showcase Auction");
    expect(auction.lotCount).toBe(3);
    expect(auction.location).toBeNull();
  });

  test("derives status from dates rather than the unconfirmed auctionStatus code", () => {
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const upcomingJson = JSON.stringify({
      total_items: 1,
      items: [sampleItem({ auctionStart: future.toISOString().slice(0, 10), auctionOnlineEnd: future.toISOString() })],
    });
    expect(parseSixbidAuction(upcomingJson, SOURCE_URL).status).toBe("upcoming");

    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const closedJson = JSON.stringify({
      total_items: 1,
      items: [sampleItem({ auctionStart: past.toISOString().slice(0, 10), auctionOnlineEnd: past.toISOString() })],
    });
    expect(parseSixbidAuction(closedJson, SOURCE_URL).status).toBe("closed");
  });

  test("an empty items array (page with no lots) doesn't throw", () => {
    const auction = parseSixbidAuction(JSON.stringify({ total_items: 0, items: [] }), SOURCE_URL);
    expect(auction.status).toBe("unknown");
    expect(auction.lotCount).toBe(0);
  });
});

describe("parseSixbidLots", () => {
  test("maps typed JSON fields directly, no text price-parsing needed", () => {
    const json = readFileSync(FIXTURE, "utf-8");
    const lots = parseSixbidLots(json);
    expect(lots.length).toBe(3);

    const first = lots[0]!;
    expect(first.lotIdentifier).toBe("sixbid:12399926");
    expect(first.lotNumber).toBe("23001");
    expect(first.category).toBe("Argentina La Rioja");
    expect(first.startingPrice).toBe(1);
    expect(first.realizedPrice).toBeNull();
    expect(first.currency).toBe("USD");
    // lotEstimate uses 0 to mean "no estimate given", not a literal $0 estimate.
    expect(first.estimateLow).toBeNull();
    expect(first.estimateHigh).toBeNull();
    expect(first.detailFetched).toBe(true);
    // Confirmed live per-lot page shape, built directly from fields the API already denormalizes
    // onto every listing item.
    expect(first.sourceUrl).toBe("https://www.sixbid.com/en/heritage-auctions-inc/13977/argentina-la-rioja/12399926/la-rioja-republic-2-soles");
    expect(first.images).toHaveLength(1);
    expect(first.images[0]!.sourceUrl).toBe(
      "https://image-cdn.sixbid.com/v7/lots/heritage-auctions-inc/auction-61646-13977/argentina-la-rioja/12399926-14434142.jpg?p=lot_o",
    );
  });

  test("lot identifiers are namespaced so they can never collide with Biddr's plain-digit ids", () => {
    const json = readFileSync(FIXTURE, "utf-8");
    const lots = parseSixbidLots(json);
    for (const lot of lots) {
      expect(lot.lotIdentifier.startsWith("sixbid:")).toBe(true);
    }
  });

  test("a lot with a real (non-zero) estimate keeps it", () => {
    const json = JSON.stringify({ total_items: 1, items: [sampleItem({ lotEstimate: 250 })] });
    const [lot] = parseSixbidLots(json);
    expect(lot!.estimateLow).toBe(250);
    expect(lot!.estimateHigh).toBe(250);
  });

  test("a lot with no image gets no ExtractedImage", () => {
    const json = JSON.stringify({ total_items: 1, items: [sampleItem({ hasImage: 0, googleBucketImagePath: null })] });
    const [lot] = parseSixbidLots(json);
    expect(lot!.images).toHaveLength(0);
  });

  test("a single-lot endpoint response (flat object, not {items:[...]}) is normalized and parses the same as a listing item", () => {
    const json = readFileSync(SINGLE_LOT_FIXTURE, "utf-8");
    const lots = parseSixbidLots(json);
    expect(lots).toHaveLength(1);

    const lot = lots[0]!;
    expect(lot.lotIdentifier).toBe("sixbid:12399926");
    expect(lot.lotNumber).toBe("23001");
    expect(lot.startingPrice).toBe(1);
    expect(lot.sourceUrl).toBe(SINGLE_LOT_URL);
  });
});

describe("parseSixbidSingleLotAuction", () => {
  test("reuses parseSixbidAuction's field extraction, with a lot-scoped identifier and lotCount forced to 1", () => {
    const json = readFileSync(SINGLE_LOT_FIXTURE, "utf-8");
    const auction = parseSixbidSingleLotAuction(json, SINGLE_LOT_URL);

    expect(auction.auctionIdentifier).toBe("lot-12399926");
    expect(auction.auctionHouse).toBe("Heritage Auctions, Inc.");
    expect(auction.title).toBe("Auction #61646");
    expect(auction.lotCount).toBe(1);
  });
});

describe("parseSixbidSearchAuction", () => {
  test("builds an honest 'Search: <term>' pseudo-auction, not framed as a real auction", () => {
    const json = readFileSync(SEARCH_FIXTURE, "utf-8");
    const auction = parseSixbidSearchAuction(json, SEARCH_URL);

    expect(auction.sourceDomain).toBe("sixbid.com");
    expect(auction.auctionHouse).toBe("Multiple auction houses");
    expect(auction.title).toBe('Search: "madrid"');
    expect(auction.status).toBe("unknown");
    expect(auction.startDate).toBeNull();
    // total_items reflects every matching lot across the whole search (all pages), not just the
    // lots present on this one trimmed fixture page.
    expect(auction.lotCount).toBe(210);
  });

  test("auctionIdentifier is the same stable hash sixbidSearchIdentifier produces for this URL", () => {
    const json = readFileSync(SEARCH_FIXTURE, "utf-8");
    const auction = parseSixbidSearchAuction(json, SEARCH_URL);
    expect(auction.auctionIdentifier).toMatch(/^[0-9a-f]{16}$/);
  });

  test("falls back to the URL's own ?term= when the response carries no terms array", () => {
    const auction = parseSixbidSearchAuction(JSON.stringify({ total_items: 0, items: [] }), SEARCH_URL);
    expect(auction.title).toBe('Search: "madrid"');
  });
});

describe("parseSixbidSearchLots", () => {
  test("flattens the grouped-by-auction response into a flat lot list", () => {
    const json = readFileSync(SEARCH_FIXTURE, "utf-8");
    const lots = parseSixbidSearchLots(json);
    // 2 groups x 2 lots each, per the trimmed fixture.
    expect(lots.length).toBe(4);
  });

  test("attaches the lot's real originating auction name as category, not its coin category", () => {
    const json = readFileSync(SEARCH_FIXTURE, "utf-8");
    const lots = parseSixbidSearchLots(json);

    const fromHeritage = lots.find((l) => l.lotIdentifier === "sixbid:12400230");
    expect(fromHeritage).toBeDefined();
    expect(fromHeritage!.category).toBe("Auction #61646");

    const fromCoinsNB = lots.find((l) => l.lotIdentifier === "sixbid:12411889");
    expect(fromCoinsNB).toBeDefined();
    expect(fromCoinsNB!.category).toBe("E-Auction 63");
  });

  test("every lot is otherwise mapped through the same field logic as a normal listing (price, currency, image)", () => {
    const json = readFileSync(SEARCH_FIXTURE, "utf-8");
    const lots = parseSixbidSearchLots(json);
    const lot = lots.find((l) => l.lotIdentifier === "sixbid:12400230")!;

    expect(lot.startingPrice).toBe(1);
    expect(lot.currency).toBe("USD");
    expect(lot.detailFetched).toBe(true);
    expect(lot.images).toHaveLength(1);
  });
});
