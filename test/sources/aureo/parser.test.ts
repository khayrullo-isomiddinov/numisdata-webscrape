import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAureoAuction, parseAureoLots, parseAureoSearchAuction, parseAureoSearchLots } from "../../../src/sources/aureo/parser.ts";

const AUCTION_URL = "https://www.aureo.com/en/subasta/0466";
const PAGE1_FIXTURE = join(import.meta.dir, "fixtures", "auction-466-page1.html");
const LAST_PAGE_FIXTURE = join(import.meta.dir, "fixtures", "auction-466-page-last.html");

const SEARCH_URL = "https://www.aureo.com/en/precios/aureoandcalico/2026";

describe("parseAureoAuction", () => {
  test("extracts house, title, closing date, and status from a closed auction's first page", () => {
    const html = readFileSync(PAGE1_FIXTURE, "utf-8");
    const auction = parseAureoAuction(html, AUCTION_URL);

    expect(auction.sourceDomain).toBe("aureo.com");
    expect(auction.auctionIdentifier).toBe("0466");
    expect(auction.auctionHouse).toBe("Aureo & Calicó");
    expect(auction.title).toBe("Auction 466");
    expect(auction.auctionNumber).toBe("466");
    expect(auction.status).toBe("closed");
    expect(auction.lotCount).toBe(2);
  });

  test("status is upcoming when no lot has a hammer price and the closing date is in the future", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const dd = String(future.getDate()).padStart(2, "0");
    const mm = String(future.getMonth() + 1).padStart(2, "0");
    const yyyy = future.getFullYear();
    const html = `<div class="row"><div class="col-12 col-lg-6 col-xl-4 my-3">
      <div class="card lot-item"><div class="card-body py-2">
        <div class="row my-0 small"><div class="col-4 p-0"><b>Lot 1</b></div><div class="col-4 text-center p-0">${dd}/${mm}/${yyyy}</div><div class="col-4 text-right p-0"><b>Auction 999</b></div></div>
        <div class="item-thumb mt-2 text-center"><a href="#" data-auction="0999" data-numcatalog="1"><img src="https://media.aureo.com/images/thumbs/0999/1.jpg"></a></div>
        <div class="item-text my-4 text-justify">Test lot. 5,00 g. MBC.</div>
        <div class="row"><div class="col-12 small"><br><b>Start: 50&euro;</b></div></div>
      </div></div>
    </div></div>`;
    const auction = parseAureoAuction(html, "https://www.aureo.com/en/subasta/0999");
    expect(auction.status).toBe("upcoming");
  });
});

describe("parseAureoLots", () => {
  test("parses lot number, namespaced identifier, and both price fields for a sold lot", () => {
    const html = readFileSync(PAGE1_FIXTURE, "utf-8");
    const lots = parseAureoLots(html, AUCTION_URL);
    expect(lots).toHaveLength(2);

    const first = lots[0]!;
    expect(first.lotIdentifier).toBe("aureo:0466:2001");
    expect(first.lotNumber).toBe("2001");
    expect(first.sourceUrl).toBe("https://www.aureo.com/en/subasta/0466");
    expect(first.startingPrice).toBe(90);
    expect(first.realizedPrice).toBe(110);
    expect(first.currency).toBe("EUR");
    expect(first.detailFetched).toBe(true);
    expect(first.category).toBeNull();
  });

  test("uses the directly-constructed full-resolution image URL, not the thumbs bucket", () => {
    const html = readFileSync(PAGE1_FIXTURE, "utf-8");
    const [first] = parseAureoLots(html, AUCTION_URL);
    expect(first!.images[0]!.sourceUrl).toBe("https://media.aureo.com/images/subastas/0466/2001.jpg");
  });

  test("extracts comma-decimal weight and the Spanish grading code", () => {
    const html = readFileSync(PAGE1_FIXTURE, "utf-8");
    const [first] = parseAureoLots(html, AUCTION_URL);
    expect(first!.weight).toBe("7.14g");
    expect(first!.condition).toBe("MBC-");
  });

  test("second lot parses independently with its own grade and prices", () => {
    const html = readFileSync(PAGE1_FIXTURE, "utf-8");
    const lots = parseAureoLots(html, AUCTION_URL);
    expect(lots[1]!.lotIdentifier).toBe("aureo:0466:2002");
    expect(lots[1]!.condition).toBe("EBC-");
    expect(lots[1]!.startingPrice).toBe(90);
    expect(lots[1]!.realizedPrice).toBe(140);
  });

  test("a lot with no hammer price yet (synthetic - not confirmed against a live open auction) has only a starting price", () => {
    const html = readFileSync(LAST_PAGE_FIXTURE, "utf-8");
    const [lot] = parseAureoLots(html, AUCTION_URL);
    expect(lot!.startingPrice).toBe(10);
    expect(lot!.currency).toBe("EUR");
    expect(lot!.realizedPrice).toBeNull();
  });
});

describe("parseAureoSearchAuction", () => {
  test("builds an honestly-labeled, already-closed pseudo-auction for a precios year", () => {
    const html = readFileSync(PAGE1_FIXTURE, "utf-8");
    const auction = parseAureoSearchAuction(html, SEARCH_URL);

    expect(auction.sourceDomain).toBe("aureo.com");
    expect(auction.auctionHouse).toBe("Aureo & Calicó");
    expect(auction.title).toBe("Historical archive: Aureo & Calicó 2026");
    expect(auction.status).toBe("closed");
    expect(auction.auctionIdentifier).toBe("aureoandcalico-2026");
  });
});

describe("parseAureoSearchLots", () => {
  test("attributes each lot to its own auction via category, and links back to that auction (not the search page)", () => {
    const html = readFileSync(PAGE1_FIXTURE, "utf-8");
    const lots = parseAureoSearchLots(html, SEARCH_URL);
    expect(lots).toHaveLength(2);
    expect(lots[0]!.category).toBe("Auction 466");
    expect(lots[0]!.sourceUrl).toBe("https://www.aureo.com/en/subasta/0466");
  });
});
