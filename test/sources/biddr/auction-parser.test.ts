import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAuction, parseSingleLotAuction, parseTotalPages } from "../../../src/sources/biddr/auction-parser.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "auctions");
const LOT_FIXTURES = join(import.meta.dir, "fixtures", "lots");

describe("parseAuction", () => {
  test("extracts an upcoming auction (The Coin Cabinet, Auction 132)", () => {
    const html = readFileSync(join(FIXTURES, "thecoincabinet-7356-p1.html"), "utf-8");
    const result = parseAuction({ html, sourceUrl: "https://www.biddr.com/thecoincabinet/auction?a=7356" });

    expect(result.auctionIdentifier).toBe("7356");
    expect(result.sourceDomain).toBe("biddr.com");
    expect(result.auctionHouse).toBe("The Coin Cabinet");
    expect(result.title).toBe("Auction 132");
    expect(result.auctionNumber).toBe("132");
    expect(result.description).toBe("British & World Coins - 20% BP");
    expect(result.lotCount).toBe(288);
    expect(result.status).toBe("upcoming");
    expect(result.startDate).toBeTruthy();
    expect(result.categories.length).toBeGreaterThan(5);
    expect(result.categories[0]).toMatchObject({ id: "174202", count: 97 });
  });

  test("extracts a closed auction (cgb, Internet Auction August 2026)", () => {
    const html = readFileSync(join(FIXTURES, "cgb-7305-p1-closed.html"), "utf-8");
    const result = parseAuction({ html, sourceUrl: "https://www.biddr.com/cgb/auction?a=7305" });

    expect(result.auctionIdentifier).toBe("7305");
    expect(result.auctionHouse).toBe("cgb.fr");
    expect(result.title).toBe("Internet Auction August 2026");
    expect(result.status).toBe("closed");
  });

  test("parseTotalPages reads the pagination select", () => {
    const html = readFileSync(join(FIXTURES, "thecoincabinet-7356-p1.html"), "utf-8");
    expect(parseTotalPages(html)).toBe(3);
  });
});

describe("parseSingleLotAuction", () => {
  test("reuses the same .catalog-title header a lot's own page renders, with a lot-scoped identifier and lotCount forced to 1", () => {
    const html = readFileSync(join(LOT_FIXTURES, "thecoincabinet-8994006.html"), "utf-8");
    const auction = parseSingleLotAuction(html, "https://www.biddr.com/thecoincabinet/auction?a=7356&l=8994006");

    expect(auction.auctionIdentifier).toBe("lot-8994006");
    expect(auction.auctionHouse).toBe("The Coin Cabinet");
    expect(auction.title).toBe("Auction 132");
    expect(auction.lotCount).toBe(1);
  });
});
