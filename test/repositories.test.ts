import { describe, expect, test } from "bun:test";
import { createTestDb } from "../src/database/schema.ts";
import { AuctionRepository } from "../src/database/repositories/auction-repository.ts";
import { LotRepository } from "../src/database/repositories/lot-repository.ts";
import { ImageRepository } from "../src/database/repositories/image-repository.ts";
import type { ExtractedAuction } from "../src/domain/auction.ts";
import type { ExtractedLot } from "../src/domain/lot.ts";

function sampleAuction(overrides: Partial<ExtractedAuction> = {}): ExtractedAuction {
  return {
    sourceUrl: "https://www.biddr.com/thecoincabinet/auction?a=7356",
    sourceDomain: "biddr.com",
    auctionIdentifier: "7356",
    auctionHouse: "The Coin Cabinet",
    title: "Auction 132",
    auctionNumber: "132",
    description: "British & World Coins",
    location: null,
    startDate: "2026-08-18T11:00:00.000Z",
    endDate: null,
    status: "upcoming",
    lotCount: 288,
    categories: [],
    raw: {},
    ...overrides,
  };
}

function sampleLot(overrides: Partial<ExtractedLot> = {}): ExtractedLot {
  return {
    sourceUrl: "https://www.biddr.com/thecoincabinet/auction?a=7356&l=8994006",
    lotIdentifier: "8994006",
    lotNumber: "1",
    title: "ENGLAND. Elizabeth I, 1558-1603. Silver Shilling",
    description: "ENGLAND. Elizabeth I, 1558-1603. Silver Shilling",
    descriptionHtml: null,
    category: null,
    estimateLow: null,
    estimateHigh: null,
    startingPrice: 20,
    realizedPrice: null,
    currency: "GBP",
    weight: null,
    diameter: null,
    material: null,
    mint: null,
    ruler: "Elizabeth I",
    denomination: "Shilling",
    datePeriod: "1558-1603",
    condition: null,
    referenceNumber: null,
    detailFetched: false,
    images: [],
    raw: {},
    ...overrides,
  };
}

describe("AuctionRepository", () => {
  test("upsert creates then updates without duplicating", () => {
    const db = createTestDb();
    const repo = new AuctionRepository(db);

    const created = repo.upsert(sampleAuction(), { acquisitionMethod: "http", rawSourcePath: "/data/x" });
    expect(created.id).toBeGreaterThan(0);
    expect(created.title).toBe("Auction 132");

    const updated = repo.upsert(sampleAuction({ title: "Auction 132 (updated)" }), {
      acquisitionMethod: "http",
      rawSourcePath: "/data/x",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("Auction 132 (updated)");

    expect(repo.list().length).toBe(1);
  });
});

describe("LotRepository", () => {
  test("upsert creates then merges without duplicating, preserving detail enrichment", () => {
    const db = createTestDb();
    const auctions = new AuctionRepository(db);
    const lots = new LotRepository(db);
    const auction = auctions.upsert(sampleAuction(), { acquisitionMethod: "http", rawSourcePath: null });

    const listingLot = lots.upsert(auction.id, sampleLot());
    expect(listingLot.weight).toBeNull();

    const detailLot = lots.upsert(
      auction.id,
      sampleLot({ weight: "5.81g", material: "Silver", detailFetched: true, description: "Full untruncated text" }),
    );
    expect(detailLot.id).toBe(listingLot.id);
    expect(detailLot.weight).toBe("5.81g");
    expect(detailLot.material).toBe("Silver");

    // A later listing-only re-scrape (Refresh) must not blank out the detail-page enrichment.
    const refreshed = lots.upsert(auction.id, sampleLot({ startingPrice: 25, description: "Truncated listing text..." }));
    expect(refreshed.id).toBe(listingLot.id);
    expect(refreshed.weight).toBe("5.81g");
    expect(refreshed.startingPrice).toBe(25);

    expect(lots.listForAuction(auction.id).length).toBe(1);
  });

  test("full text search finds lots by title/description", () => {
    const db = createTestDb();
    const auctions = new AuctionRepository(db);
    const lots = new LotRepository(db);
    const auction = auctions.upsert(sampleAuction(), { acquisitionMethod: "http", rawSourcePath: null });
    lots.upsert(auction.id, sampleLot());
    lots.upsert(
      auction.id,
      sampleLot({
        lotIdentifier: "8994007",
        lotNumber: "2",
        title: "Athens Tetradrachm",
        description: "Greek silver tetradrachm of Athens",
        ruler: null,
        denomination: "Tetradrachm",
      }),
    );

    const results = lots.search("tetradrachm");
    expect(results.length).toBe(1);
    expect(results[0]!.lotIdentifier).toBe("8994007");

    const results2 = lots.search("Elizabeth");
    expect(results2.length).toBe(1);
    expect(results2[0]!.lotIdentifier).toBe("8994006");
  });

  test("facet filtering narrows results", () => {
    const db = createTestDb();
    const auctions = new AuctionRepository(db);
    const lots = new LotRepository(db);
    const auction = auctions.upsert(sampleAuction(), { acquisitionMethod: "http", rawSourcePath: null });
    lots.upsert(auction.id, sampleLot({ material: "Silver" }));
    lots.upsert(auction.id, sampleLot({ lotIdentifier: "8994007", lotNumber: "2", material: "Gold" }));

    expect(lots.listForAuction(auction.id, { material: "Gold" }).length).toBe(1);
    expect(lots.listForAuction(auction.id).length).toBe(2);
  });

  test("deleteByIds removes only the given lots, scoped to their auction, cascading images", () => {
    const db = createTestDb();
    const auctions = new AuctionRepository(db);
    const lots = new LotRepository(db);
    const images = new ImageRepository(db);
    const auctionA = auctions.upsert(sampleAuction(), { acquisitionMethod: "http", rawSourcePath: null });
    const auctionB = auctions.upsert(sampleAuction({ auctionIdentifier: "9999", title: "Other auction" }), {
      acquisitionMethod: "http",
      rawSourcePath: null,
    });

    const keep = lots.upsert(auctionA.id, sampleLot());
    const remove = lots.upsert(
      auctionA.id,
      sampleLot({ lotIdentifier: "8994007", lotNumber: "2", title: "James I Shilling", description: "James I Shilling", ruler: "James I" }),
    );
    const otherAuctionLot = lots.upsert(auctionB.id, sampleLot({ lotIdentifier: "8994008", lotNumber: "1" }));
    images.replaceForLot(remove.id, [{ sourceUrl: "https://media.biddr.com/x.jpg", order: 0, width: null, height: null }]);

    // A stray id from a different auction must be ignored, not deleted.
    const deleted = lots.deleteByIds(auctionA.id, [remove.id, otherAuctionLot.id]);

    expect(deleted).toBe(1);
    expect(lots.findById(remove.id)).toBeNull();
    expect(lots.findById(keep.id)).not.toBeNull();
    expect(lots.findById(otherAuctionLot.id)).not.toBeNull();
    expect(images.listForLot(remove.id).length).toBe(0);
    expect(lots.search("James").length).toBe(0);
  });
});

describe("ImageRepository", () => {
  test("replaceForLot preserves local_path for unchanged source URLs", () => {
    const db = createTestDb();
    const auctions = new AuctionRepository(db);
    const lots = new LotRepository(db);
    const images = new ImageRepository(db);
    const auction = auctions.upsert(sampleAuction(), { acquisitionMethod: "http", rawSourcePath: null });
    const lot = lots.upsert(auction.id, sampleLot());

    images.replaceForLot(lot.id, [{ sourceUrl: "https://media.biddr.com/a.jpg", order: 0, width: 100, height: 100 }]);
    const [first] = images.listForLot(lot.id);
    images.setLocalPath(first!.id, "data/images/8994006/0.jpg");

    images.replaceForLot(lot.id, [
      { sourceUrl: "https://media.biddr.com/a.jpg", order: 0, width: 100, height: 100 },
      { sourceUrl: "https://media.biddr.com/b.jpg", order: 1, width: 100, height: 100 },
    ]);

    const after = images.listForLot(lot.id);
    expect(after.length).toBe(2);
    expect(after.find((i) => i.sourceUrl.endsWith("a.jpg"))?.localPath).toBe("data/images/8994006/0.jpg");
    expect(after.find((i) => i.sourceUrl.endsWith("b.jpg"))?.localPath).toBeNull();
  });
});
