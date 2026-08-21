import { describe, expect, test } from "bun:test";
import { jesusvicoLotIdentifier, parseJesusvicoAuctionNumber, parseJesusvicoLotNumber } from "../../../src/sources/jesusvico/acquisition.ts";

describe("parseJesusvicoLotNumber", () => {
  test("extracts the lot number from an English-locale '/lot/' URL", () => {
    expect(parseJesusvicoLotNumber("https://www.jesusvico.com/en/lot/I180-2984-2984/1001-491-carlos-iv-1788-1808")).toBe("1001");
  });

  test("extracts the lot number from a Spanish-locale '/lote/' URL", () => {
    expect(parseJesusvicoLotNumber("https://www.jesusvico.com/es/lote/I179-3005-3005/191-505-reyes-catolicos")).toBe("191");
  });

  test("returns null for an auction-listing URL (no lot segment)", () => {
    expect(parseJesusvicoLotNumber("https://www.jesusvico.com/en/subasta/subasta-180-coleccion-segarra-vol-iii_I180-001")).toBeNull();
  });
});

describe("jesusvicoLotIdentifier", () => {
  test("combines the auction number and lot number, distinct from the full auction's own identifier", () => {
    const id = jesusvicoLotIdentifier("https://www.jesusvico.com/es/lote/I179-3005-3005/191-505-reyes-catolicos");
    expect(id).toBe("lot-179-191");
    expect(id).not.toBe(parseJesusvicoAuctionNumber("https://www.jesusvico.com/es/lote/I179-3005-3005/191-505-reyes-catolicos"));
  });

  test("null for a normal auction-listing URL", () => {
    expect(jesusvicoLotIdentifier("https://www.jesusvico.com/en/subasta/subasta-180-coleccion-segarra-vol-iii_I180-001")).toBeNull();
  });
});
