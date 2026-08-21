import { describe, expect, test } from "bun:test";
import { numisbidsLotIdentifier, numisbidsSearchIdentifier, parseNumisbidsLotUrl, parseNumisbidsSearchUrl } from "../../../src/sources/numisbids/acquisition.ts";

describe("parseNumisbidsSearchUrl", () => {
  test("extracts the searchall query param from a real search URL", () => {
    const params = parseNumisbidsSearchUrl("https://www.numisbids.com/searchall?searchall=madrid");
    expect(params).not.toBeNull();
    expect(params!.get("searchall")).toBe("madrid");
  });

  test("returns null for a normal sale URL", () => {
    expect(parseNumisbidsSearchUrl("https://www.numisbids.com/sale/11005")).toBeNull();
  });

  test("returns null when searchall is present but empty", () => {
    expect(parseNumisbidsSearchUrl("https://www.numisbids.com/searchall?searchall=")).toBeNull();
  });

  test("returns null for a non-numisbids URL", () => {
    expect(parseNumisbidsSearchUrl("https://www.biddr.com/searchall?searchall=madrid")).toBeNull();
  });
});

describe("numisbidsSearchIdentifier", () => {
  test("is stable regardless of query-param order", () => {
    const a = numisbidsSearchIdentifier("https://www.numisbids.com/searchall?searchall=madrid&so=1");
    const b = numisbidsSearchIdentifier("https://www.numisbids.com/searchall?so=1&searchall=madrid");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  test("differs for a different search term", () => {
    const a = numisbidsSearchIdentifier("https://www.numisbids.com/searchall?searchall=madrid");
    const b = numisbidsSearchIdentifier("https://www.numisbids.com/searchall?searchall=denarius");
    expect(a).not.toBe(b);
  });

  test("null for a normal sale URL (no search identifier)", () => {
    expect(numisbidsSearchIdentifier("https://www.numisbids.com/sale/11005")).toBeNull();
  });
});

describe("parseNumisbidsLotUrl", () => {
  test("extracts saleId + lotNumber from a real single-lot URL", () => {
    expect(parseNumisbidsLotUrl("https://www.numisbids.com/sale/10982/lot/33272")).toEqual({ saleId: "10982", lotNumber: "33272" });
  });

  test("returns null for a plain sale-listing URL (no lot segment)", () => {
    expect(parseNumisbidsLotUrl("https://www.numisbids.com/sale/11005")).toBeNull();
  });

  test("returns null for a non-numisbids URL", () => {
    expect(parseNumisbidsLotUrl("https://www.biddr.com/sale/10982/lot/33272")).toBeNull();
  });
});

describe("numisbidsLotIdentifier", () => {
  test("combines the sale id and lot number, distinct from the full sale's own identifier", () => {
    const id = numisbidsLotIdentifier("https://www.numisbids.com/sale/10982/lot/33272");
    expect(id).toBe("lot-10982-33272");
    expect(id).not.toBe("10982");
  });

  test("null for a plain sale-listing URL", () => {
    expect(numisbidsLotIdentifier("https://www.numisbids.com/sale/11005")).toBeNull();
  });
});
