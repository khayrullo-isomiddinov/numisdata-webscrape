import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Must run before any import in this file resolves getDb() at call-time - persistPages/getDb()
// are only invoked inside test bodies below, so setting this here (module top-level, executed
// after import linking but before any test runs) safely isolates this file from the real
// ./data/archive.sqlite the running dev server may be using.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "coins-ingestion-test-")), "archive.sqlite");

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getDb } from "../src/database/schema.ts";
import { LotRepository } from "../src/database/repositories/lot-repository.ts";
import { persistPages } from "../src/web/services/ingestion-service.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "auctions", "thecoincabinet-7356-p1.html");
const SOURCE_URL = "https://www.biddr.com/thecoincabinet/auction?a=7356";

describe("persistPages exclusion handling", () => {
  test("a deleted lot does not reappear when the same source is re-parsed (Refresh/Re-import)", () => {
    const html = readFileSync(FIXTURE, "utf-8");
    const first = persistPages(SOURCE_URL, [{ html, finalUrl: SOURCE_URL, httpStatus: 200, contentType: "text/html" }], "http", null);
    expect(first.lotCount).toBe(100);

    const db = getDb();
    const lots = new LotRepository(db);
    const target = lots.findByIdentifier("8994006");
    expect(target).not.toBeNull();

    const deleted = lots.deleteByIds(first.auction.id, [target!.id]);
    expect(deleted).toBe(1);
    expect(lots.findByIdentifier("8994006")).toBeNull();

    // Re-parsing the exact same source (as Refresh/Re-import would) must respect the exclusion.
    const second = persistPages(SOURCE_URL, [{ html, finalUrl: SOURCE_URL, httpStatus: 200, contentType: "text/html" }], "http", null);
    expect(second.lotCount).toBe(99);
    expect(lots.findByIdentifier("8994006")).toBeNull();
    expect(lots.listForAuction(first.auction.id).length).toBe(99);

    // Every other lot still updates normally.
    expect(lots.findByIdentifier("8994007")).not.toBeNull();
  });
});
