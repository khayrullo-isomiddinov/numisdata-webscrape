import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated from the real ./data/archive.sqlite, same pattern as test/ingestion-service.test.ts -
// kept in its own file (own temp DB) so this doesn't share auto-incremented lot ids or reused
// Biddr lot identifiers with any other test file.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "coins-delete-archive-test-")), "archive.sqlite");

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { getDb } from "../src/database/schema.ts";
import { AuctionRepository } from "../src/database/repositories/auction-repository.ts";
import { LotRepository } from "../src/database/repositories/lot-repository.ts";
import { deleteAuctionArchive, persistPages } from "../src/web/services/ingestion-service.ts";
import { biddrAdapter } from "../src/sources/biddr/adapter.ts";

const FIXTURE = join(import.meta.dir, "sources", "biddr", "fixtures", "auctions", "thecoincabinet-7356-p1.html");
const SOURCE_URL = "https://www.biddr.com/thecoincabinet/auction?a=7356";

describe("deleteAuctionArchive", () => {
  test("removes the DB row (cascading to lots) and every file on disk (raw source snapshot + downloaded images)", async () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const rawSourceDir = mkdtempSync(join(tmpdir(), "coins-delete-archive-source-"));
    writeFileSync(join(rawSourceDir, "metadata.json"), JSON.stringify({ fixture: "delete-archive-test" }), "utf-8");

    const result = persistPages(
      biddrAdapter,
      SOURCE_URL,
      [{ html, finalUrl: SOURCE_URL, httpStatus: 200, contentType: "text/html" }],
      "http",
      rawSourceDir,
    );

    const db = getDb();
    const auctions = new AuctionRepository(db);
    const lots = new LotRepository(db);
    const lotIds = lots.listForAuction(result.auction.id).map((l) => l.id);
    expect(lotIds.length).toBe(result.lotCount);

    // IMAGES_ROOT in src/acquisition/image-downloader.ts is join(process.cwd(), "data", "images") -
    // not test-isolated. SAFETY CHECK: refuse to touch any directory that isn't one this test just
    // created, so a coincidental lot-id collision with real archived data can never be deleted.
    const imageDirs = lotIds.map((id) => join(process.cwd(), "data", "images", String(id)));
    for (const dir of imageDirs) {
      if (existsSync(dir)) {
        throw new Error(`SAFETY CHECK FAILED - ${dir} already exists, refusing to use it as test fixture data.`);
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "fixture.txt"), "delete-archive-test", "utf-8");
    }

    try {
      await deleteAuctionArchive(result.auction.id);

      expect(auctions.findById(result.auction.id)).toBeNull();
      expect(lots.listForAuction(result.auction.id).length).toBe(0);
      expect(existsSync(rawSourceDir)).toBe(false);
      for (const dir of imageDirs) {
        expect(existsSync(dir)).toBe(false);
      }
    } finally {
      // Belt-and-suspenders: clean up even if an assertion above threw mid-test.
      if (existsSync(rawSourceDir)) rmSync(rawSourceDir, { recursive: true, force: true });
      for (const dir of imageDirs) {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("throws for a non-existent auction id", async () => {
    await expect(deleteAuctionArchive(-1)).rejects.toThrow("Auction not found.");
  });
});
