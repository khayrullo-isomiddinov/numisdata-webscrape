import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLotDetail, parseLotListing, parseSearchResultLots } from "../../../src/sources/biddr/lot-parser.ts";
import { parseSearchAuction } from "../../../src/sources/biddr/auction-parser.ts";

const AUCTION_FIXTURES = join(import.meta.dir, "fixtures", "auctions");
const LOT_FIXTURES = join(import.meta.dir, "fixtures", "lots");
const SEARCH_FIXTURE = join(import.meta.dir, "fixtures", "search-valentia.html");
const SEARCH_URL = "https://www.biddr.com/search?s=valentia&c=&pf=&pt=&pc=EUR";

describe("parseLotListing", () => {
  test("extracts lot cards from an upcoming auction listing", () => {
    const html = readFileSync(join(AUCTION_FIXTURES, "thecoincabinet-7356-p1.html"), "utf-8");
    const lots = parseLotListing(html, "https://www.biddr.com/thecoincabinet/auction?a=7356");

    expect(lots.length).toBe(100);

    const first = lots[0]!;
    expect(first.lotIdentifier).toBe("8994006");
    expect(first.lotNumber).toBe("1");
    expect(first.title).toContain("ENGLAND. Elizabeth I, 1558-1603");
    expect(first.startingPrice).toBe(20);
    expect(first.currency).toBe("GBP");
    expect(first.realizedPrice).toBeNull();
    // Full resolution, not the ".l." thumbnail - confirmed live that every listing card's
    // .lot-image block also carries a full-size PhotoSwipe link the old parser never read.
    expect(first.images[0]?.sourceUrl).toBe("https://media.biddr.com/media/img/auction_lots/7356/8994006_1786366325.jpg");
    expect(first.images[0]?.width).toBe(1705);
    expect(first.images[0]?.height).toBe(800);
    expect(first.sourceUrl).toBe("https://www.biddr.com/thecoincabinet/auction?a=7356&l=8994006");
  });

  test("extracts realized prices from a closed auction listing", () => {
    const html = readFileSync(join(AUCTION_FIXTURES, "cgb-7305-p1-closed.html"), "utf-8");
    const lots = parseLotListing(html, "https://www.biddr.com/cgb/auction?a=7305");

    expect(lots.length).toBeGreaterThan(0);
    const first = lots[0]!;
    expect(first.realizedPrice).toBe(125);
    expect(first.currency).toBe("EUR");
    expect(first.startingPrice).toBeNull();
  });
});

describe("parseSearchResultLots", () => {
  test("groups lots by their real originating auction via the .search-divider header", () => {
    const html = readFileSync(SEARCH_FIXTURE, "utf-8");
    const lots = parseSearchResultLots(html, SEARCH_URL);

    expect(lots).toHaveLength(3);
    expect(lots[0]!.category).toBe("NBJ the Art of Numismatic, Auction 19");
    expect(lots[1]!.category).toBe("Artemide Aste, Auction 76E");
    expect(lots[2]!.category).toBe("Artemide Aste, Auction 76E");
  });

  test("extracts the lot number and strips the auction-name prefix, unlike a normal listing's plain 'Lot N.' format", () => {
    const html = readFileSync(SEARCH_FIXTURE, "utf-8");
    const [first] = parseSearchResultLots(html, SEARCH_URL);

    expect(first!.lotNumber).toBe("408");
    expect(first!.title).not.toContain("NBJ the Art of Numismatic");
    expect(first!.title).toContain("FRANCE: Provincial. Valence");
    // Full original text (including the auction-name prefix) is still preserved in description.
    expect(first!.description).toContain("NBJ the Art of Numismatic, Auction 19, lot 408.");
  });

  test("each result carries its own genuine per-auction lot URL and full-resolution image", () => {
    const html = readFileSync(SEARCH_FIXTURE, "utf-8");
    const lots = parseSearchResultLots(html, SEARCH_URL);

    expect(lots[0]!.sourceUrl).toBe("https://www.biddr.com/nbjgallery/auction?a=7349&l=8988589");
    expect(lots[1]!.sourceUrl).toBe("https://www.biddr.com/artemideaste/auction?a=7298&l=8922295");
    expect(lots[0]!.images[0]!.sourceUrl).toBe("https://media.biddr.com/media/img/auction_lots/7349/8988589_1786110888.jpg");
    expect(lots[0]!.images[0]!.width).toBe(2500);
  });

  test("lot identifiers are Biddr's own global lot ids, unnamespaced - a search hit and a normal retrieval of the same lot converge", () => {
    const html = readFileSync(SEARCH_FIXTURE, "utf-8");
    const [first] = parseSearchResultLots(html, SEARCH_URL);
    expect(first!.lotIdentifier).toBe("8988589");
  });
});

describe("parseSearchAuction", () => {
  test("builds an honestly-labeled pseudo-auction for the search", () => {
    const html = readFileSync(SEARCH_FIXTURE, "utf-8");
    const auction = parseSearchAuction(html, SEARCH_URL);

    expect(auction.sourceDomain).toBe("biddr.com");
    expect(auction.auctionHouse).toBe("Multiple auction houses");
    expect(auction.title).toBe('Search: "valentia"');
    expect(auction.status).toBe("unknown");
    expect(auction.lotCount).toBe(3);
    expect(auction.auctionIdentifier.length).toBeGreaterThan(0);
  });

  test("the same search URL always produces the same identifier (dedupe correctness)", () => {
    const html = readFileSync(SEARCH_FIXTURE, "utf-8");
    const a = parseSearchAuction(html, SEARCH_URL);
    const b = parseSearchAuction(html, SEARCH_URL);
    expect(a.auctionIdentifier).toBe(b.auctionIdentifier);
  });
});

describe("parseLotDetail", () => {
  test("extracts full metadata from a lot detail page", () => {
    const html = readFileSync(join(LOT_FIXTURES, "thecoincabinet-8994006.html"), "utf-8");
    const lot = parseLotDetail(html, "https://www.biddr.com/thecoincabinet/auction?a=7356&l=8994006");

    expect(lot).not.toBeNull();
    expect(lot!.lotIdentifier).toBe("8994006");
    expect(lot!.lotNumber).toBe("1");
    expect(lot!.weight).toBe("7.68g");
    expect(lot!.material).toBe("Silver");
    expect(lot!.startingPrice).toBe(20);
    expect(lot!.estimateLow).toBe(50);
    expect(lot!.estimateHigh).toBe(50);
    expect(lot!.currency).toBe("GBP");
    expect(lot!.detailFetched).toBe(true);
    expect(lot!.images.length).toBe(3);
    expect(lot!.description).toContain("Elizabeth I");
  });
});
