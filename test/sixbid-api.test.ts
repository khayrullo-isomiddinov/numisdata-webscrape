import { describe, expect, test, mock } from "bun:test";
import { acquireSixbidAuction, parseSixbidUrl, SixbidArchivedError } from "../src/acquisition/sixbid-api.ts";

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
