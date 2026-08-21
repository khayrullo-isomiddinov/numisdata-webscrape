import { describe, expect, test } from "bun:test";
import { biddrSearchIdentifier, biddrSingleLotIdentifier, parseBiddrSearchUrl, parseBiddrSingleLotUrl } from "../../../src/sources/biddr/acquisition.ts";

describe("parseBiddrSearchUrl", () => {
  test("extracts query params from a real search URL", () => {
    const params = parseBiddrSearchUrl("https://www.biddr.com/search?s=valentia&c=&pf=&pt=&pc=EUR");
    expect(params).not.toBeNull();
    expect(params!.get("s")).toBe("valentia");
    expect(params!.get("pc")).toBe("EUR");
  });

  test("returns null for a normal auction URL", () => {
    expect(parseBiddrSearchUrl("https://www.biddr.com/thecoincabinet/auction?a=7356")).toBeNull();
  });

  test("returns null for a non-Biddr URL", () => {
    expect(parseBiddrSearchUrl("https://www.sixbid.com/search?s=valentia")).toBeNull();
  });
});

describe("biddrSearchIdentifier", () => {
  test("is stable regardless of query-param order", () => {
    const a = biddrSearchIdentifier("https://www.biddr.com/search?s=valentia&c=&pf=&pt=&pc=EUR");
    const b = biddrSearchIdentifier("https://www.biddr.com/search?pc=EUR&pt=&pf=&c=&s=valentia");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  test("differs for a different search term", () => {
    const a = biddrSearchIdentifier("https://www.biddr.com/search?s=valentia&c=&pf=&pt=&pc=EUR");
    const b = biddrSearchIdentifier("https://www.biddr.com/search?s=denarius&c=&pf=&pt=&pc=EUR");
    expect(a).not.toBe(b);
  });

  test("null for a normal auction URL (no search identifier)", () => {
    expect(biddrSearchIdentifier("https://www.biddr.com/thecoincabinet/auction?a=7356")).toBeNull();
  });
});

describe("parseBiddrSingleLotUrl", () => {
  test("extracts both auction and lot ids from a real single-lot URL", () => {
    const parsed = parseBiddrSingleLotUrl("https://www.biddr.com/bac/auction?a=7359&l=8996598");
    expect(parsed).toEqual({ auctionId: "7359", lotId: "8996598" });
  });

  test("returns null when only ?a= is present (a full auction listing, not a single lot)", () => {
    expect(parseBiddrSingleLotUrl("https://www.biddr.com/thecoincabinet/auction?a=7356")).toBeNull();
  });

  test("returns null for a non-Biddr URL", () => {
    expect(parseBiddrSingleLotUrl("https://www.numisbids.com/sale/1?a=1&l=1")).toBeNull();
  });
});

describe("biddrSingleLotIdentifier", () => {
  test("is lot-scoped, distinct from the full auction's own numeric id", () => {
    const id = biddrSingleLotIdentifier("https://www.biddr.com/bac/auction?a=7359&l=8996598");
    expect(id).toBe("lot-8996598");
    expect(id).not.toBe("7359");
  });

  test("null for a full auction URL with no ?l=", () => {
    expect(biddrSingleLotIdentifier("https://www.biddr.com/thecoincabinet/auction?a=7356")).toBeNull();
  });
});
