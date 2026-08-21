import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseJesusvicoAuction,
  parseJesusvicoLotDetail,
  parseJesusvicoLots,
  parseJesusvicoSingleLotAuction,
  parseJesusvicoTotalPages,
} from "../../../src/sources/jesusvico/parser.ts";

const LISTING_FIXTURE = join(import.meta.dir, "fixtures", "listing", "subasta-180.html");
const LISTING_URL = "https://www.jesusvico.com/en/subasta/subasta-180-coleccion-segarra-vol-iii_I180-001";

const ES_LISTING_FIXTURE = join(import.meta.dir, "fixtures", "listing", "subasta-179-es-filtered.html");
const ES_LISTING_URL =
  "https://www.jesusvico.com/es/subasta/2a-sesion-subasta-extraordinaria-179_I179-002?oldpage=&oldlot=&order=&total=&historic=&description=madrid&reference=&category=";

const DETAIL_FIXTURE = join(import.meta.dir, "fixtures", "detail", "lot-1001.html");
const DETAIL_URL = "https://www.jesusvico.com/en/lot/I180-2984-2984/1001-491-carlos-iv-1788-1808";

const ES_DETAIL_FIXTURE = join(import.meta.dir, "fixtures", "detail", "lote-191.html");
const ES_DETAIL_URL = "https://www.jesusvico.com/es/lote/I179-3005-3005/191-505-reyes-catolicos";

describe("parseJesusvicoAuction", () => {
  test("extracts title, auction number, and lot count", () => {
    const html = readFileSync(LISTING_FIXTURE, "utf-8");
    const auction = parseJesusvicoAuction(html, LISTING_URL);

    expect(auction.sourceDomain).toBe("jesusvico.com");
    expect(auction.auctionIdentifier).toBe("180");
    expect(auction.auctionNumber).toBe("180");
    expect(auction.auctionHouse).toBe("Jesús Vico");
    expect(auction.title).toBe("Subasta 180 - Colección Segarra Vol. III");
    expect(auction.lotCount).toBe(3);
  });

  test("status falls back to closed when the parsed date is in the past, even if data-closed=0", () => {
    const html = readFileSync(LISTING_FIXTURE, "utf-8");
    const auction = parseJesusvicoAuction(html, LISTING_URL);
    // Fixture's countdown says data-closed="0", but its date (02/07/2026) is in the past relative
    // to whenever this test runs for the foreseeable future - the date cross-check should win.
    expect(auction.status).toBe("closed");
  });

  test("status is upcoming for a future date with data-closed=0", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const dd = String(future.getDate()).padStart(2, "0");
    const mm = String(future.getMonth() + 1).padStart(2, "0");
    const yyyy = future.getFullYear();
    const html = `<html><body>
      <h1 class="text-uppercase"><a href=""><b>Subasta 999 - Test Auction</b></a></h1>
      <div class="filters-auction-countdown"><div class="filter-title">
        <p data-countdown="100" data-closed="0" class="timer"></p>
        <p>${dd}/${mm}/${yyyy} 11:00 CET</p>
      </div></div>
    </body></html>`;
    const auction = parseJesusvicoAuction(html, "https://www.jesusvico.com/en/subasta/test_I999-001");
    expect(auction.status).toBe("upcoming");
  });

  test("extracts title and lot count from a Spanish-locale filtered/search listing page", () => {
    const html = readFileSync(ES_LISTING_FIXTURE, "utf-8");
    const auction = parseJesusvicoAuction(html, ES_LISTING_URL);

    expect(auction.auctionIdentifier).toBe("179");
    expect(auction.title).toBe("2ª Sesión - Subasta Extraordinaria 179");
    expect(auction.lotCount).toBe(2);
  });
});

describe("parseJesusvicoTotalPages", () => {
  test("finds the max page= link in the fixture (page 6)", () => {
    const html = readFileSync(LISTING_FIXTURE, "utf-8");
    expect(parseJesusvicoTotalPages(html)).toBe(6);
  });

  test("defaults to 1 when no page links are present", () => {
    expect(parseJesusvicoTotalPages("<html><body>no pagination here</body></html>")).toBe(1);
  });
});

describe("parseJesusvicoLots", () => {
  test("parses lot number, identifier namespacing, and European prices", () => {
    const html = readFileSync(LISTING_FIXTURE, "utf-8");
    const lots = parseJesusvicoLots(html, LISTING_URL);
    expect(lots).toHaveLength(3);

    const first = lots[0]!;
    expect(first.lotIdentifier).toBe("jesusvico:180:1001");
    expect(first.lotNumber).toBe("1001");
    expect(first.sourceUrl).toBe("https://www.jesusvico.com/en/lot/I180-2984-2984/1001-491-carlos-iv-1788-1808");
    expect(first.startingPrice).toBe(6000);
    expect(first.realizedPrice).toBe(7750);
    expect(first.currency).toBe("EUR");
    expect(first.detailFetched).toBe(false);
  });

  test("weight and diameter extracted from the bare 'X g. Y mm.' pattern (no label)", () => {
    const html = readFileSync(LISTING_FIXTURE, "utf-8");
    const [first] = parseJesusvicoLots(html, LISTING_URL);
    expect(first!.weight).toBe("26.92g");
    expect(first!.diameter).toBe("36.7mm");
  });

  test("image is upgraded from the 838 thumbnail bucket to the full-resolution original", () => {
    const html = readFileSync(LISTING_FIXTURE, "utf-8");
    const [first] = parseJesusvicoLots(html, LISTING_URL);
    expect(first!.images[0]!.sourceUrl).not.toContain("/thumbs/838/");
    expect(first!.images[0]!.sourceUrl).toBe("https://www.jesusvico.com/img/001/491/001-491-1.jpg?a=1781512537");
  });

  test("second and third lots parse independently with their own prices", () => {
    const html = readFileSync(LISTING_FIXTURE, "utf-8");
    const lots = parseJesusvicoLots(html, LISTING_URL);
    expect(lots[1]!.lotIdentifier).toBe("jesusvico:180:1002");
    expect(lots[1]!.startingPrice).toBe(8000);
    expect(lots[1]!.realizedPrice).toBe(11500);
    expect(lots[2]!.lotIdentifier).toBe("jesusvico:180:1003");
    expect(lots[2]!.startingPrice).toBe(5000);
    expect(lots[2]!.realizedPrice).toBe(9250);
  });

  test("Spanish-locale listing pages ('Lote N' not 'Lot N') parse the same as English-locale ones - regression for a bug where a filtered/searched Spanish auction URL silently returned 0 lots", () => {
    const html = readFileSync(ES_LISTING_FIXTURE, "utf-8");
    const lots = parseJesusvicoLots(html, ES_LISTING_URL);
    expect(lots).toHaveLength(2);

    expect(lots[0]!.lotIdentifier).toBe("jesusvico:179:215");
    expect(lots[0]!.lotNumber).toBe("215");
    expect(lots[0]!.startingPrice).toBe(900);
    expect(lots[0]!.realizedPrice).toBe(1150);
    expect(lots[0]!.currency).toBe("EUR");

    expect(lots[1]!.lotIdentifier).toBe("jesusvico:179:261");
    expect(lots[1]!.lotNumber).toBe("261");
    expect(lots[1]!.startingPrice).toBe(650);
    expect(lots[1]!.realizedPrice).toBe(725);
  });

  test("a lot with no 'SOLD BY' price block has a null realizedPrice (unsold-lot case, synthetic - not yet observed live)", () => {
    const html = `<div class="card lot-card">
      <a href="https://www.jesusvico.com/en/lot/I180-9999-9999/2001-1-test-lot" class="stretched-link"></a>
      <h2 class="card-lot-title">Lot 2001</h2>
      <h5 class="card-title max-line-2">Test lot description. AU 10.00 g. 20.0 mm.</h5>
      <div class="lot-prices-gird">
        <p class="lot-salida-price">Starting price</p>
        <p class="lot-salida-price lot-salida-price-value">1.000 €</p>
      </div>
      <img class="card-img-top" src="https://www.jesusvico.com/img/thumbs/838/002/1/002-1-1.jpg">
    </div>`;
    const [lot] = parseJesusvicoLots(html, LISTING_URL);
    expect(lot!.startingPrice).toBe(1000);
    expect(lot!.realizedPrice).toBeNull();
  });
});

describe("parseJesusvicoLotDetail", () => {
  test("collects the gallery's full-resolution originals, deduped, in order - not the 838 thumbnails or the 100px ones", () => {
    const html = readFileSync(DETAIL_FIXTURE, "utf-8");
    const lot = parseJesusvicoLotDetail(html, DETAIL_URL);

    expect(lot).not.toBeNull();
    expect(lot!.lotIdentifier).toBe("jesusvico:180:1001");
    expect(lot!.detailFetched).toBe(true);
    expect(lot!.images).toHaveLength(4);
    for (const img of lot!.images) {
      expect(img.sourceUrl).not.toContain("/thumbs/838/");
      expect(img.sourceUrl).toContain("/img/");
    }
    expect(lot!.images[0]!.sourceUrl).toContain("001-491-1.jpg");
    expect(lot!.images[3]!.sourceUrl).toContain("001-491-1_03.jpg");
  });

  test("price fields are left null so mergeLot preserves the listing's values", () => {
    const html = readFileSync(DETAIL_FIXTURE, "utf-8");
    const lot = parseJesusvicoLotDetail(html, DETAIL_URL);
    expect(lot!.startingPrice).toBeNull();
    expect(lot!.realizedPrice).toBeNull();
  });

  test("returns null for a page without a .long-description element", () => {
    const lot = parseJesusvicoLotDetail("<html><body>not a lot page</body></html>", DETAIL_URL);
    expect(lot).toBeNull();
  });

  test("Spanish-locale '/lote/' URLs parse the same as English-locale '/lot/' ones", () => {
    const html = readFileSync(ES_DETAIL_FIXTURE, "utf-8");
    const lot = parseJesusvicoLotDetail(html, ES_DETAIL_URL);

    expect(lot).not.toBeNull();
    expect(lot!.lotIdentifier).toBe("jesusvico:179:191");
    expect(lot!.lotNumber).toBe("191");
    expect(lot!.detailFetched).toBe(true);
    expect(lot!.description).toContain("REYES CATÓLICOS");
    expect(lot!.weight).toBe("6.75g");
    expect(lot!.diameter).toBe("29.6mm");
    expect(lot!.images).toHaveLength(1);
    expect(lot!.images[0]!.sourceUrl).toBe("https://www.jesusvico.com/img/001/505/001-505-191.jpg?a=1781253532");
  });
});

describe("parseJesusvicoSingleLotAuction", () => {
  test("builds an honestly-unknown pseudo-auction from the URL alone (no auction header exists on a lot detail page)", () => {
    const auction = parseJesusvicoSingleLotAuction(ES_DETAIL_URL);

    expect(auction.sourceDomain).toBe("jesusvico.com");
    expect(auction.auctionIdentifier).toBe("lot-179-191");
    expect(auction.auctionHouse).toBe("Jesús Vico");
    expect(auction.title).toBe("Auction 179, Lot 191");
    expect(auction.auctionNumber).toBe("179");
    expect(auction.status).toBe("unknown");
    expect(auction.lotCount).toBe(1);
  });
});
