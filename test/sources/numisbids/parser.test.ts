import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseNumisbidsAuction,
  parseNumisbidsLotDetail,
  parseNumisbidsLots,
  parseNumisbidsSearchAuction,
  parseNumisbidsSearchLots,
  parseNumisbidsSingleLotAuction,
  parseNumisbidsTotalPages,
} from "../../../src/sources/numisbids/parser.ts";

const OPEN_SALE_FIXTURE = join(import.meta.dir, "fixtures", "sale-open.html");
const OPEN_SALE_URL = "https://www.numisbids.com/sale/11005";

const CLOSED_SALE_FIXTURE = join(import.meta.dir, "fixtures", "sale-closed.html");
const CLOSED_SALE_URL = "https://www.numisbids.com/sale/10900";

const OPEN_LOT_FIXTURE = join(import.meta.dir, "fixtures", "lot-3001-open.html");
const OPEN_LOT_URL = "https://www.numisbids.com/sale/11005/lot/3001";

const CLOSED_LOT_FIXTURE = join(import.meta.dir, "fixtures", "lot-2-closed.html");
const CLOSED_LOT_URL = "https://www.numisbids.com/sale/10900/lot/2";

const SEARCH_FIXTURE = join(import.meta.dir, "fixtures", "search-madrid.html");
const SEARCH_URL = "https://www.numisbids.com/searchall?searchall=madrid";

const SEARCH_ZERO_FIXTURE = join(import.meta.dir, "fixtures", "search-zero-results.html");
const SEARCH_ZERO_URL = "https://www.numisbids.com/searchall?searchall=zzzzznonexistentqueryxyz123";

const SINGLE_LOT_FIXTURE = join(import.meta.dir, "fixtures", "lot-33272-singlelot.html");
const SINGLE_LOT_URL = "https://www.numisbids.com/sale/10982/lot/33272";

describe("parseNumisbidsAuction", () => {
  test("extracts house, title, dates, and status for a live sale with an active countdown", () => {
    const html = readFileSync(OPEN_SALE_FIXTURE, "utf-8");
    const auction = parseNumisbidsAuction(html, OPEN_SALE_URL);

    expect(auction.sourceDomain).toBe("numisbids.com");
    expect(auction.auctionIdentifier).toBe("11005");
    expect(auction.auctionHouse).toBe("Heritage World Coin Auctions");
    expect(auction.title).toBe("ANA Signature Sale 1396");
    expect(auction.status).toBe("live");
    expect(auction.lotCount).toBe(2);
  });

  test("status is closed when the countdown block is absent, even with a past single date", () => {
    const html = readFileSync(CLOSED_SALE_FIXTURE, "utf-8");
    const auction = parseNumisbidsAuction(html, CLOSED_SALE_URL);

    expect(auction.auctionHouse).toBe("Spink");
    expect(auction.title).toBe("Auction 26200");
    expect(auction.status).toBe("closed");
  });

  test("status is closed when a countdown is present but the printed end date has already passed", () => {
    const html = `<div class="salestatus"><div class="text"><span class="name">Test House</span><br><b>Test Sale</b>&nbsp;&nbsp;1 Jan - 2 Jan 2020<br><div class="closing">Session 1 begins closing in<br><span class="countdown">stale</span></div></div></div>`;
    const auction = parseNumisbidsAuction(html, "https://www.numisbids.com/sale/1");
    expect(auction.status).toBe("closed");
  });
});

describe("parseNumisbidsTotalPages", () => {
  test("reads 'Page 1 of 21' from the open sale fixture", () => {
    const html = readFileSync(OPEN_SALE_FIXTURE, "utf-8");
    expect(parseNumisbidsTotalPages(html)).toBe(21);
  });

  test("reads 'Page 1 of 8' from the closed sale fixture", () => {
    const html = readFileSync(CLOSED_SALE_FIXTURE, "utf-8");
    expect(parseNumisbidsTotalPages(html)).toBe(8);
  });

  test("defaults to 1 when no pagination text is present", () => {
    expect(parseNumisbidsTotalPages("<html><body>no pagination here</body></html>")).toBe(1);
  });
});

describe("parseNumisbidsLots", () => {
  test("parses lot number, the real lid-based identifier, and the open-sale starting price", () => {
    const html = readFileSync(OPEN_SALE_FIXTURE, "utf-8");
    const lots = parseNumisbidsLots(html, OPEN_SALE_URL);
    expect(lots).toHaveLength(2);

    const first = lots[0]!;
    expect(first.lotIdentifier).toBe("numisbids:12252828");
    expect(first.lotNumber).toBe("3001");
    expect(first.sourceUrl).toBe("https://www.numisbids.com/sale/11005/lot/3001");
    expect(first.startingPrice).toBe(1);
    expect(first.realizedPrice).toBeNull();
    expect(first.currency).toBe("USD");
    expect(first.detailFetched).toBe(false);
  });

  test("uses the full-resolution imgenlarge_overlay link, not the thumb-prefixed browseimg", () => {
    const html = readFileSync(OPEN_SALE_FIXTURE, "utf-8");
    const [first] = parseNumisbidsLots(html, OPEN_SALE_URL);
    expect(first!.images[0]!.sourceUrl).toBe("https://media.numisbids.com/sales/hosted/heritage/1396/image03001.jpg");
  });

  test("title/description come from the truncated .summary text", () => {
    const html = readFileSync(OPEN_SALE_FIXTURE, "utf-8");
    const [first] = parseNumisbidsLots(html, OPEN_SALE_URL);
    expect(first!.title).toContain("Betts Medals 1580 Medal Spanish Conquest of Portugal");
    expect(first!.title).toContain("...");
  });

  test("a closed-sale unsold lot has no realized price and the starting price is preserved", () => {
    const html = readFileSync(CLOSED_SALE_FIXTURE, "utf-8");
    const lots = parseNumisbidsLots(html, CLOSED_SALE_URL);
    const unsold = lots[0]!;
    expect(unsold.lotNumber).toBe("1");
    expect(unsold.startingPrice).toBe(300);
    expect(unsold.currency).toBe("GBP");
    expect(unsold.realizedPrice).toBeNull();
  });

  test("a closed-sale sold lot has both starting price and realized price", () => {
    const html = readFileSync(CLOSED_SALE_FIXTURE, "utf-8");
    const lots = parseNumisbidsLots(html, CLOSED_SALE_URL);
    const sold = lots[1]!;
    expect(sold.lotNumber).toBe("2");
    expect(sold.startingPrice).toBe(160);
    expect(sold.realizedPrice).toBe(320);
    expect(sold.currency).toBe("GBP");
  });

  test("skips a card with no watchlot lid rather than guessing an identifier", () => {
    const html = `<div class="browse"><div class="browsetext-top"><div class="left"><span class="lot"><a href="/sale/1/lot/1">Lot 1</a></span></div></div><div class="browsetext"><span class="summary"><a href="/sale/1/lot/1">No lid here</a></span></div></div>`;
    const lots = parseNumisbidsLots(html, "https://www.numisbids.com/sale/1");
    expect(lots).toHaveLength(0);
  });
});

describe("parseNumisbidsLotDetail", () => {
  test("full description excludes the #postbid/#watchnote decoy elements sharing the same class", () => {
    const html = readFileSync(OPEN_LOT_FIXTURE, "utf-8");
    const lot = parseNumisbidsLotDetail(html, OPEN_LOT_URL);

    expect(lot).not.toBeNull();
    expect(lot!.lotIdentifier).toBe("numisbids:12252828");
    expect(lot!.lotNumber).toBe("3001");
    expect(lot!.detailFetched).toBe(true);
    // A <br> with no surrounding whitespace in the source markup (confirmed live) must become a
    // real space, not vanish and glue adjacent words together.
    expect(lot!.description).toContain("Betts Medals\n1580 Medal Spanish Conquest");
    expect(lot!.description).toContain("Costa Family Collection");
    expect(lot!.description).not.toContain("Watch List notes");
    expect(lot!.description).not.toContain("Save a note here");
  });

  test("collects the full multi-image gallery in order, not just the listing's one thumbnail", () => {
    const html = readFileSync(OPEN_LOT_FIXTURE, "utf-8");
    const lot = parseNumisbidsLotDetail(html, OPEN_LOT_URL);
    expect(lot!.images).toHaveLength(2);
    expect(lot!.images[0]!.sourceUrl).toBe("https://media.numisbids.com/sales/hosted/heritage/1396/image03001.jpg");
    expect(lot!.images[1]!.sourceUrl).toBe("https://media.numisbids.com/sales/hosted/heritage/1396/image03001_1.jpg");
  });

  test("captures both starting price and current bid on an in-progress lot", () => {
    const html = readFileSync(OPEN_LOT_FIXTURE, "utf-8");
    const lot = parseNumisbidsLotDetail(html, OPEN_LOT_URL);
    expect(lot!.startingPrice).toBe(1);
    expect(lot!.realizedPrice).toBeNull();
    expect(lot!.currency).toBe("USD");
    expect((lot!.raw as { currentBid?: number }).currentBid).toBe(15);
  });

  test("captures both starting price and price realized on a sold, closed lot", () => {
    const html = readFileSync(CLOSED_LOT_FIXTURE, "utf-8");
    const lot = parseNumisbidsLotDetail(html, CLOSED_LOT_URL);
    expect(lot!.lotIdentifier).toBe("numisbids:12146993");
    expect(lot!.startingPrice).toBe(160);
    expect(lot!.realizedPrice).toBe(320);
    expect(lot!.currency).toBe("GBP");
  });

  test("returns null for a page without a .viewlot element", () => {
    const lot = parseNumisbidsLotDetail("<html><body>not a lot page</body></html>", OPEN_LOT_URL);
    expect(lot).toBeNull();
  });

  test("a six-figure price with a narrow-no-break-space thousands separator isn't truncated to just the last group", () => {
    const html = readFileSync(SINGLE_LOT_FIXTURE, "utf-8");
    const lot = parseNumisbidsLotDetail(html, SINGLE_LOT_URL);
    expect(lot!.startingPrice).toBe(250000);
    expect(lot!.currency).toBe("USD");
    expect((lot!.raw as { currentBid?: number }).currentBid).toBe(250000);
  });
});

describe("parseNumisbidsSingleLotAuction", () => {
  test("reuses the same .salestatus header a lot's own page renders, with a lot-scoped identifier and lotCount forced to 1", () => {
    const html = readFileSync(SINGLE_LOT_FIXTURE, "utf-8");
    const auction = parseNumisbidsSingleLotAuction(html, SINGLE_LOT_URL);

    expect(auction.auctionIdentifier).toBe("lot-10982-33272");
    expect(auction.auctionHouse).toBe("Heritage World Coin Auctions");
    expect(auction.title).toBe("ANA Signature Sale 3135");
    expect(auction.status).toBe("live");
    expect(auction.lotCount).toBe(1);
  });
});

describe("parseNumisbidsSearchAuction", () => {
  test("builds an honestly-labeled pseudo-auction from the URL's search term", () => {
    const html = readFileSync(SEARCH_FIXTURE, "utf-8");
    const auction = parseNumisbidsSearchAuction(html, SEARCH_URL);

    expect(auction.sourceDomain).toBe("numisbids.com");
    expect(auction.auctionHouse).toBe("Multiple auction houses");
    expect(auction.title).toBe('Search: "madrid"');
    expect(auction.status).toBe("unknown");
    expect(auction.lotCount).toBe(2);
    expect(auction.auctionIdentifier).toHaveLength(16);
  });
});

describe("parseNumisbidsSearchLots", () => {
  test("attributes each lot to its real originating auction via the preceding .salestatus", () => {
    const html = readFileSync(SEARCH_FIXTURE, "utf-8");
    const lots = parseNumisbidsSearchLots(html, SEARCH_URL);
    expect(lots).toHaveLength(2);

    expect(lots[0]!.lotIdentifier).toBe("numisbids:12205147");
    expect(lots[0]!.lotNumber).toBe("140");
    expect(lots[0]!.category).toBe("17 Auctions S.L - Auction 34");
    expect(lots[0]!.startingPrice).toBe(1);
    expect(lots[0]!.currency).toBe("EUR");

    expect(lots[1]!.lotIdentifier).toBe("numisbids:12210204");
    expect(lots[1]!.lotNumber).toBe("637");
    expect(lots[1]!.category).toBe("Numismatik Zöttl - Auction 51");
    expect(lots[1]!.startingPrice).toBe(25);
  });

  test("preserves a multi-line summary (real newlines in the source markup, not <br>)", () => {
    const html = readFileSync(SEARCH_FIXTURE, "utf-8");
    const lots = parseNumisbidsSearchLots(html, SEARCH_URL);
    expect(lots[1]!.title).toContain("Papst Benedikt XVI. 2005-2013");
    expect(lots[1]!.title).toContain("Weltjugendtag 2011 in Madrid");
  });

  test("a zero-result search page yields no lots", () => {
    const html = readFileSync(SEARCH_ZERO_FIXTURE, "utf-8");
    const lots = parseNumisbidsSearchLots(html, SEARCH_ZERO_URL);
    expect(lots).toHaveLength(0);
  });
});
