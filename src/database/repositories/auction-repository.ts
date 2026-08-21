import type { Database } from "bun:sqlite";
import type { Auction, AuctionStatus, ExtractedAuction } from "../../domain/auction.ts";
import type { AcquisitionMethod } from "../../domain/image.ts";

interface AuctionRow {
  id: number;
  source_url: string;
  source_domain: string;
  auction_identifier: string;
  auction_house: string | null;
  title: string | null;
  auction_number: string | null;
  description: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  lot_count: number | null;
  imported_at: string;
  updated_at: string;
  acquisition_method: string;
  raw_source_path: string | null;
  raw_data_json: string | null;
}

function mapRow(row: AuctionRow): Auction {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    sourceDomain: row.source_domain,
    auctionIdentifier: row.auction_identifier,
    auctionHouse: row.auction_house,
    title: row.title,
    auctionNumber: row.auction_number,
    description: row.description,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as AuctionStatus,
    lotCount: row.lot_count,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
    acquisitionMethod: row.acquisition_method,
    rawSourcePath: row.raw_source_path,
  };
}

export class AuctionRepository {
  constructor(private readonly db: Database) {}

  findByIdentifier(sourceDomain: string, auctionIdentifier: string): Auction | null {
    const row = this.db
      .query<AuctionRow, [string, string]>("SELECT * FROM auctions WHERE source_domain = ? AND auction_identifier = ?")
      .get(sourceDomain, auctionIdentifier);
    return row ? mapRow(row) : null;
  }

  findById(id: number): Auction | null {
    const row = this.db.query<AuctionRow, [number]>("SELECT * FROM auctions WHERE id = ?").get(id);
    return row ? mapRow(row) : null;
  }

  /** Creates the auction if it doesn't exist yet (matched by source_domain + auction_identifier); otherwise updates metadata. */
  upsert(
    extracted: ExtractedAuction,
    context: { acquisitionMethod: AcquisitionMethod; rawSourcePath: string | null },
  ): Auction {
    const now = new Date().toISOString();
    const existing = this.findByIdentifier(extracted.sourceDomain, extracted.auctionIdentifier);
    const rawJson = JSON.stringify({ categories: extracted.categories, ...extracted.raw });

    if (existing) {
      this.db
        .query(
          `UPDATE auctions SET
            source_url = ?, auction_house = ?, title = ?, auction_number = ?, description = ?,
            location = ?, start_date = ?, end_date = ?, status = ?, lot_count = ?,
            updated_at = ?, acquisition_method = ?, raw_source_path = ?, raw_data_json = ?
           WHERE id = ?`,
        )
        .run(
          extracted.sourceUrl,
          extracted.auctionHouse,
          extracted.title,
          extracted.auctionNumber,
          extracted.description,
          extracted.location,
          extracted.startDate,
          extracted.endDate,
          extracted.status,
          extracted.lotCount,
          now,
          context.acquisitionMethod,
          context.rawSourcePath,
          rawJson,
          existing.id,
        );
      return this.findById(existing.id)!;
    }

    const result = this.db
      .query(
        `INSERT INTO auctions (
          source_url, source_domain, auction_identifier, auction_house, title, auction_number,
          description, location, start_date, end_date, status, lot_count,
          imported_at, updated_at, acquisition_method, raw_source_path, raw_data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        extracted.sourceUrl,
        extracted.sourceDomain,
        extracted.auctionIdentifier,
        extracted.auctionHouse,
        extracted.title,
        extracted.auctionNumber,
        extracted.description,
        extracted.location,
        extracted.startDate,
        extracted.endDate,
        extracted.status,
        extracted.lotCount,
        now,
        now,
        context.acquisitionMethod,
        context.rawSourcePath,
        rawJson,
      );
    return this.findById(Number(result.lastInsertRowid))!;
  }

  list(filters: { search?: string } = {}): Array<Auction & { lotCountActual: number }> {
    const rows = this.db
      .query<AuctionRow & { lot_count_actual: number }, []>(
        `SELECT a.*, (SELECT COUNT(*) FROM lots l WHERE l.auction_id = a.id) AS lot_count_actual
         FROM auctions a ORDER BY a.imported_at DESC`,
      )
      .all();
    return rows.map((row) => ({ ...mapRow(row), lotCountActual: row.lot_count_actual }));
  }

  touchUpdatedAt(id: number): void {
    this.db.query("UPDATE auctions SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  /** Deletes the auction row - lots/images cascade via their FKs, acquisition_runs.auction_id is set NULL. */
  delete(id: number): void {
    this.db.query("DELETE FROM auctions WHERE id = ?").run(id);
  }
}
