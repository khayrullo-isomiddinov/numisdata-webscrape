import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLotDetail, parseLotListing } from "../src/extraction/lot-parser.ts";

const AUCTION_FIXTURES = join(import.meta.dir, "fixtures", "auctions");
const LOT_FIXTURES = join(import.meta.dir, "fixtures", "lots");

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
    expect(first.images[0]?.sourceUrl).toContain("8994006_1786366325.l.jpg");
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
