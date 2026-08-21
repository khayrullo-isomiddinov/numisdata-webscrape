import { describe, expect, test } from "bun:test";
import { aureoSearchIdentifier, parseAureoAuctionId, parseAureoSearchUrl } from "../../../src/sources/aureo/acquisition.ts";

describe("parseAureoAuctionId", () => {
  test("extracts the 4-digit auction id from a real auction URL", () => {
    expect(parseAureoAuctionId("https://www.aureo.com/en/subasta/0466")).toBe("0466");
  });

  test("returns null for a precios search URL", () => {
    expect(parseAureoAuctionId("https://www.aureo.com/en/precios/aureoandcalico/2026")).toBeNull();
  });

  test("returns null for a non-aureo URL", () => {
    expect(parseAureoAuctionId("https://www.numisbids.com/sale/11005")).toBeNull();
  });

  test("extracts a hyphenated, session-suffixed auction id (multi-session auction, confirmed live)", () => {
    // data-auction="0200-1" is what the site's own AJAX calls use verbatim for this auction - not
    // a lot number, a real 775-lot full auction with a session suffix baked into its own id.
    expect(parseAureoAuctionId("https://www.aureo.com/en/subasta/0200-1")).toBe("0200-1");
  });
});

describe("parseAureoSearchUrl", () => {
  test("extracts brand and year from a real precios URL", () => {
    const parsed = parseAureoSearchUrl("https://www.aureo.com/en/precios/aureoandcalico/2026");
    expect(parsed).toEqual({ brand: "aureoandcalico", year: "2026" });
  });

  test("accepts the calico and aureo brand slugs too", () => {
    expect(parseAureoSearchUrl("https://www.aureo.com/en/precios/calico/2020")).toEqual({ brand: "calico", year: "2020" });
    expect(parseAureoSearchUrl("https://www.aureo.com/en/precios/aureo/2015")).toEqual({ brand: "aureo", year: "2015" });
  });

  test("returns null for a brand-only URL with no year", () => {
    expect(parseAureoSearchUrl("https://www.aureo.com/en/precios/aureoandcalico")).toBeNull();
  });

  test("returns null for an unrecognized brand slug", () => {
    expect(parseAureoSearchUrl("https://www.aureo.com/en/precios/notabrand/2026")).toBeNull();
  });

  test("returns null for a normal auction URL", () => {
    expect(parseAureoSearchUrl("https://www.aureo.com/en/subasta/0466")).toBeNull();
  });
});

describe("aureoSearchIdentifier", () => {
  test("is the plain brand-year string, no hashing needed", () => {
    expect(aureoSearchIdentifier("https://www.aureo.com/en/precios/aureoandcalico/2026")).toBe("aureoandcalico-2026");
  });

  test("null for a normal auction URL", () => {
    expect(aureoSearchIdentifier("https://www.aureo.com/en/subasta/0466")).toBeNull();
  });
});
