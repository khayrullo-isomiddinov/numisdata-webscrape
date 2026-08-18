import { describe, expect, test } from "bun:test";
import {
  extractDenomination,
  extractDiameter,
  extractMaterial,
  extractRulerAndDate,
  extractWeight,
  parsePrice,
  parsePriceRange,
} from "../src/extraction/parser-utils.ts";

describe("parsePrice", () => {
  test("parses amount + ISO currency code", () => {
    expect(parsePrice("125 EUR")).toEqual({ amount: 125, currency: "EUR" });
    expect(parsePrice("20 GBP")).toEqual({ amount: 20, currency: "GBP" });
  });

  test("parses thousands separators", () => {
    expect(parsePrice("1,250.50 USD")).toEqual({ amount: 1250.5, currency: "USD" });
  });

  test("parses symbol-prefixed prices", () => {
    expect(parsePrice("€1,250")).toEqual({ amount: 1250, currency: "EUR" });
  });

  test("returns null for empty/unparsable input", () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("no price here")).toBeNull();
  });
});

describe("parsePriceRange", () => {
  test("parses a low-high range", () => {
    expect(parsePriceRange("500 - 700 GBP")).toEqual({ low: 500, high: 700, currency: "GBP" });
  });

  test("treats a single value as low === high", () => {
    expect(parsePriceRange("50 GBP")).toEqual({ low: 50, high: 50, currency: "GBP" });
  });
});

describe("numismatic field heuristics", () => {
  test("extractWeight", () => {
    expect(extractWeight("Weight: 7.68g.")).toBe("7.68g");
    expect(extractWeight("no weight mentioned")).toBeNull();
  });

  test("extractDiameter", () => {
    expect(extractDiameter("Diameter: 27mm.")).toBe("27mm");
  });

  test("extractMaterial prefers explicit composition label", () => {
    expect(extractMaterial("Composition: Silver.")).toBe("Silver");
    expect(extractMaterial("Silver Shilling of Elizabeth I")).toBe("Silver");
    expect(extractMaterial("A fine specimen with no metal noted")).toBeNull();
  });

  test("extractDenomination", () => {
    expect(extractDenomination("Silver Shilling/Threepence/Penny")).toBe("Shilling");
    expect(extractDenomination("Greek Silver Tetradrachm")).toBe("Tetradrachm");
  });

  test("extractRulerAndDate", () => {
    expect(extractRulerAndDate("ENGLAND. Elizabeth I, 1558-1603. Silver Shilling")).toEqual({
      ruler: "Elizabeth I",
      datePeriod: "1558-1603",
    });
  });
});
