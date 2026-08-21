import { describe, expect, test, mock } from "bun:test";
import {
  acquireSixbidAuction,
  parseSixbidLotUrl,
  parseSixbidSearchUrl,
  parseSixbidUrl,
  sixbidLotIdentifier,
  sixbidSearchIdentifier,
  SixbidArchivedError,
} from "../../../src/sources/sixbid/api.ts";

describe("parseSixbidUrl", () => {
  test("extracts companySlug + auctionId, tolerating the locale prefix and trailing page segments", () => {
    expect(
      parseSixbidUrl(
        "https://www.sixbid.com/en/heritage-auctions-inc/13977/page/1/perPage/100?term&orderCol=lot_number",
      ),
    ).toEqual({ companySlug: "heritage-auctions-inc", auctionId: "13977" });
  });

  test("works without a locale prefix", () => {
    expect(parseSixbidUrl("https://www.sixbid.com/heritage-auctions-inc/13977")).toEqual({
      companySlug: "heritage-auctions-inc",
      auctionId: "13977",
    });
  });

  test("returns null for a non-sixbid URL", () => {
    expect(parseSixbidUrl("https://www.biddr.com/thecoincabinet/auction?a=7356")).toBeNull();
  });

  test("returns null when no numeric auction id is present", () => {
    expect(parseSixbidUrl("https://www.sixbid.com/en/heritage-auctions-inc/")).toBeNull();
  });
});

describe("parseSixbidLotUrl", () => {
  test("extracts companySlug + auctionId + lotId from a real single-lot URL", () => {
    const parsed = parseSixbidLotUrl(
      "https://www.sixbid.com/en/heritage-auctions-inc/13977/argentina-la-rioja/12399926/la-rioja-republic-2-soles?term&orderCol=lot_number&orderDirection=asc&priceFrom&displayMode=large&auctionSessions=&sidebarIsSticky=false",
    );
    expect(parsed).toEqual({ companySlug: "heritage-auctions-inc", auctionId: "13977", lotId: "12399926" });
  });

  test("returns null for a plain auction-listing URL (no lot id segment)", () => {
    expect(parseSixbidLotUrl("https://www.sixbid.com/en/heritage-auctions-inc/13977/page/1/perPage/100")).toBeNull();
  });

  test("returns null for a non-sixbid URL", () => {
    expect(parseSixbidLotUrl("https://www.biddr.com/thecoincabinet/auction?a=7356")).toBeNull();
  });
});

describe("sixbidLotIdentifier", () => {
  test("is lot-scoped, distinct from the full auction's own numeric id", () => {
    const id = sixbidLotIdentifier("https://www.sixbid.com/en/heritage-auctions-inc/13977/argentina-la-rioja/12399926/la-rioja-republic-2-soles");
    expect(id).toBe("lot-12399926");
    expect(id).not.toBe("13977");
  });

  test("null for a plain auction-listing URL", () => {
    expect(sixbidLotIdentifier("https://www.sixbid.com/en/heritage-auctions-inc/13977/page/1/perPage/100")).toBeNull();
  });
});

describe("parseSixbidSearchUrl", () => {
  test("extracts term + currency from a real search URL", () => {
    expect(parseSixbidSearchUrl("https://www.sixbid.com/en/lots/page/1/perPage/100?term=madrid&currency=EUR")).toEqual({
      term: "madrid",
      currency: "EUR",
    });
  });

  test("currency is null when absent", () => {
    expect(parseSixbidSearchUrl("https://www.sixbid.com/en/lots/page/1/perPage/100?term=madrid")).toEqual({
      term: "madrid",
      currency: null,
    });
  });

  test("works without a locale prefix", () => {
    expect(parseSixbidSearchUrl("https://www.sixbid.com/lots/page/1/perPage/100?term=madrid")).toEqual({
      term: "madrid",
      currency: null,
    });
  });

  test("returns null when term is missing", () => {
    expect(parseSixbidSearchUrl("https://www.sixbid.com/en/lots/page/1/perPage/100?currency=EUR")).toBeNull();
  });

  test("returns null for a normal per-auction listing URL (no /lots segment)", () => {
    expect(parseSixbidSearchUrl("https://www.sixbid.com/en/heritage-auctions-inc/13977/page/1/perPage/100")).toBeNull();
  });

  test("returns null for a single-lot URL", () => {
    expect(
      parseSixbidSearchUrl("https://www.sixbid.com/en/heritage-auctions-inc/13977/argentina-la-rioja/12399926/la-rioja-republic-2-soles"),
    ).toBeNull();
  });

  test("returns null for a non-sixbid URL", () => {
    expect(parseSixbidSearchUrl("https://www.biddr.com/search?s=madrid")).toBeNull();
  });
});

describe("sixbidSearchIdentifier", () => {
  test("is a stable 16-char hex hash, distinct across different terms", () => {
    const id1 = sixbidSearchIdentifier("https://www.sixbid.com/en/lots/page/1/perPage/100?term=madrid&currency=EUR");
    const id2 = sixbidSearchIdentifier("https://www.sixbid.com/en/lots/page/1/perPage/100?term=barcelona&currency=EUR");
    expect(id1).toMatch(/^[0-9a-f]{16}$/);
    expect(id2).toMatch(/^[0-9a-f]{16}$/);
    expect(id1).not.toBe(id2);
  });

  test("is stable regardless of query-param order", () => {
    const a = sixbidSearchIdentifier("https://www.sixbid.com/en/lots/page/1/perPage/100?term=madrid&currency=EUR");
    const b = sixbidSearchIdentifier("https://www.sixbid.com/en/lots/page/1/perPage/100?currency=EUR&term=madrid");
    expect(a).toBe(b);
  });

  test("null for a non-search URL", () => {
    expect(sixbidSearchIdentifier("https://www.sixbid.com/en/heritage-auctions-inc/13977")).toBeNull();
  });
});

describe("acquireSixbidAuction", () => {
  test("throws SixbidArchivedError when the API reports the auction moved to the coin archive", async () => {
    const originalFetch = global.fetch;
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            url: "Please refer to the coin archive to see old data",
            name: "https://www.sixbid-coin-archive.com/",
            code: 403,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    try {
      await expect(acquireSixbidAuction("https://www.sixbid.com/en/some-house/999/page/1")).rejects.toThrow(
        SixbidArchivedError,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects a non-sixbid URL before making any request", async () => {
    await expect(acquireSixbidAuction("https://www.biddr.com/thecoincabinet/auction?a=7356")).rejects.toThrow();
  });
});
