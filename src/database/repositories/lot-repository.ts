import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { ExtractedLot, Lot } from "../../domain/lot.ts";

interface LotRow {
  id: number;
  auction_id: number;
  source_url: string | null;
  lot_identifier: string;
  lot_number: string | null;
  title: string | null;
  description: string | null;
  description_html: string | null;
  category: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  starting_price: number | null;
  realized_price: number | null;
  currency: string | null;
  weight: string | null;
  diameter: string | null;
  material: string | null;
  mint: string | null;
  ruler: string | null;
  denomination: string | null;
  date_period: string | null;
  condition: string | null;
  reference_number: string | null;
  detail_fetched: number;
  imported_at: string;
  updated_at: string;
  raw_data_json: string | null;
}

function mapRow(row: LotRow): Lot {
  return {
    id: row.id,
    auctionId: row.auction_id,
    sourceUrl: row.source_url,
    lotIdentifier: row.lot_identifier,
    lotNumber: row.lot_number,
    title: row.title,
    description: row.description,
    descriptionHtml: row.description_html,
    category: row.category,
    estimateLow: row.estimate_low,
    estimateHigh: row.estimate_high,
    startingPrice: row.starting_price,
    realizedPrice: row.realized_price,
    currency: row.currency,
    weight: row.weight,
    diameter: row.diameter,
    material: row.material,
    mint: row.mint,
    ruler: row.ruler,
    denomination: row.denomination,
    datePeriod: row.date_period,
    condition: row.condition,
    referenceNumber: row.reference_number,
    detailFetched: row.detail_fetched === 1,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
    rawDataJson: row.raw_data_json,
  };
}

const ENRICHABLE_FIELDS = [
  "description",
  "descriptionHtml",
  "estimateLow",
  "estimateHigh",
  "weight",
  "diameter",
  "material",
  "mint",
  "ruler",
  "denomination",
  "datePeriod",
  "condition",
  "referenceNumber",
] as const;

/**
 * Merges a freshly-extracted lot on top of whatever we already have. Prices are always taken
 * from the newest extraction (they're live and a Refresh is expected to update them). Detail-page
 * fields are only allowed to improve: a listing-only re-scrape (detailFetched=false) must never
 * blank out richer data a prior detail-page fetch already established, though it may still fill
 * genuinely empty gaps.
 */
function mergeLot(existing: Lot | null, incoming: ExtractedLot): ExtractedLot {
  if (!existing) return incoming;

  const merged: ExtractedLot = { ...incoming };
  if (existing.detailFetched && !incoming.detailFetched) {
    for (const field of ENRICHABLE_FIELDS) {
      const incomingValue = merged[field];
      const existingValue = existing[field];
      if ((incomingValue === null || incomingValue === undefined) && existingValue !== null) {
        (merged as any)[field] = existingValue;
      } else if (existingValue !== null) {
        // Keep the richer, previously-fetched value rather than a truncated listing-page guess.
        (merged as any)[field] = existingValue;
      }
    }
    merged.detailFetched = true;
  }
  if (merged.startingPrice === null) merged.startingPrice = existing.startingPrice;
  if (merged.realizedPrice === null) merged.realizedPrice = existing.realizedPrice;
  if (merged.currency === null) merged.currency = existing.currency;
  if (merged.category === null) merged.category = existing.category;
  if (merged.sourceUrl === null) merged.sourceUrl = existing.sourceUrl;
  if (merged.lotNumber === null) merged.lotNumber = existing.lotNumber;
  if (merged.title === null) merged.title = existing.title;
  return merged;
}

export class LotRepository {
  constructor(private readonly db: Database) {}

  findByIdentifier(lotIdentifier: string): Lot | null {
    const row = this.db.query<LotRow, [string]>("SELECT * FROM lots WHERE lot_identifier = ?").get(lotIdentifier);
    return row ? mapRow(row) : null;
  }

  findById(id: number): Lot | null {
    const row = this.db.query<LotRow, [number]>("SELECT * FROM lots WHERE id = ?").get(id);
    return row ? mapRow(row) : null;
  }

  /**
   * Deletes exactly the given lot ids, scoped to one auction (a stray id from elsewhere in the
   * archive is silently ignored rather than acted on), and records their lot_identifier in
   * excluded_lots so a later Refresh/Re-import doesn't silently resurrect them (see
   * listExcludedIdentifiers - persistPages in ingestion-service.ts consults it before upserting).
   * Images cascade via the FK; the FTS index cleans itself up via the lots_ad trigger. Returns how
   * many rows were actually removed.
   */
  deleteByIds(auctionId: number, lotIds: number[]): number {
    if (lotIds.length === 0) return 0;
    const placeholders = lotIds.map(() => "?").join(", ");

    return this.db.transaction(() => {
      const identifierRows = this.db
        .query<{ lot_identifier: string }, SQLQueryBindings[]>(
          `SELECT lot_identifier FROM lots WHERE auction_id = ? AND id IN (${placeholders})`,
        )
        .all(auctionId, ...lotIds);

      const now = new Date().toISOString();
      const insertExclusion = this.db.query(
        "INSERT OR IGNORE INTO excluded_lots (auction_id, lot_identifier, excluded_at) VALUES (?, ?, ?)",
      );
      for (const row of identifierRows) {
        insertExclusion.run(auctionId, row.lot_identifier, now);
      }

      this.db.query(`DELETE FROM lots WHERE auction_id = ? AND id IN (${placeholders})`).run(auctionId, ...lotIds);
      return identifierRows.length;
    })();
  }

  listExcludedIdentifiers(auctionId: number): Set<string> {
    const rows = this.db
      .query<{ lot_identifier: string }, [number]>("SELECT lot_identifier FROM excluded_lots WHERE auction_id = ?")
      .all(auctionId);
    return new Set(rows.map((r) => r.lot_identifier));
  }

  /** Creates the lot if new, otherwise merges freshly-extracted fields onto the existing row. See mergeLot. */
  upsert(auctionId: number, extracted: ExtractedLot): Lot {
    const now = new Date().toISOString();
    const existing = this.findByIdentifier(extracted.lotIdentifier);
    const merged = mergeLot(existing, extracted);
    const rawJson = JSON.stringify(merged.raw ?? {});

    if (existing) {
      this.db
        .query(
          `UPDATE lots SET
            source_url = ?, lot_number = ?, title = ?, description = ?, description_html = ?,
            category = ?, estimate_low = ?, estimate_high = ?, starting_price = ?, realized_price = ?,
            currency = ?, weight = ?, diameter = ?, material = ?, mint = ?, ruler = ?, denomination = ?,
            date_period = ?, condition = ?, reference_number = ?, detail_fetched = ?, updated_at = ?,
            raw_data_json = ?
           WHERE id = ?`,
        )
        .run(
          merged.sourceUrl,
          merged.lotNumber,
          merged.title,
          merged.description,
          merged.descriptionHtml,
          merged.category,
          merged.estimateLow,
          merged.estimateHigh,
          merged.startingPrice,
          merged.realizedPrice,
          merged.currency,
          merged.weight,
          merged.diameter,
          merged.material,
          merged.mint,
          merged.ruler,
          merged.denomination,
          merged.datePeriod,
          merged.condition,
          merged.referenceNumber,
          merged.detailFetched ? 1 : 0,
          now,
          rawJson,
          existing.id,
        );
      return this.findById(existing.id)!;
    }

    const result = this.db
      .query(
        `INSERT INTO lots (
          auction_id, source_url, lot_identifier, lot_number, title, description, description_html,
          category, estimate_low, estimate_high, starting_price, realized_price, currency,
          weight, diameter, material, mint, ruler, denomination, date_period, condition,
          reference_number, detail_fetched, imported_at, updated_at, raw_data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        auctionId,
        merged.sourceUrl,
        merged.lotIdentifier,
        merged.lotNumber,
        merged.title,
        merged.description,
        merged.descriptionHtml,
        merged.category,
        merged.estimateLow,
        merged.estimateHigh,
        merged.startingPrice,
        merged.realizedPrice,
        merged.currency,
        merged.weight,
        merged.diameter,
        merged.material,
        merged.mint,
        merged.ruler,
        merged.denomination,
        merged.datePeriod,
        merged.condition,
        merged.referenceNumber,
        merged.detailFetched ? 1 : 0,
        now,
        now,
        rawJson,
      );
    return this.findById(Number(result.lastInsertRowid))!;
  }

  listForAuction(
    auctionId: number,
    filters: {
      category?: string;
      material?: string;
      mint?: string;
      ruler?: string;
      denomination?: string;
      priceMin?: number;
      priceMax?: number;
      sort?: "lot_asc" | "lot_desc" | "price_asc" | "price_desc";
    } = {},
  ): Lot[] {
    const clauses: string[] = ["auction_id = ?"];
    const params: SQLQueryBindings[] = [auctionId];

    if (filters.category) {
      clauses.push("category = ?");
      params.push(filters.category);
    }
    if (filters.material) {
      clauses.push("material = ?");
      params.push(filters.material);
    }
    if (filters.mint) {
      clauses.push("mint = ?");
      params.push(filters.mint);
    }
    if (filters.ruler) {
      clauses.push("ruler = ?");
      params.push(filters.ruler);
    }
    if (filters.denomination) {
      clauses.push("denomination = ?");
      params.push(filters.denomination);
    }
    if (filters.priceMin !== undefined) {
      clauses.push("COALESCE(realized_price, starting_price, estimate_low) >= ?");
      params.push(filters.priceMin);
    }
    if (filters.priceMax !== undefined) {
      clauses.push("COALESCE(realized_price, starting_price, estimate_low) <= ?");
      params.push(filters.priceMax);
    }

    const orderBy =
      {
        lot_asc: "CAST(lot_number AS INTEGER) ASC",
        lot_desc: "CAST(lot_number AS INTEGER) DESC",
        price_asc: "COALESCE(realized_price, starting_price, estimate_low) ASC",
        price_desc: "COALESCE(realized_price, starting_price, estimate_low) DESC",
      }[filters.sort ?? "lot_asc"] ?? "CAST(lot_number AS INTEGER) ASC";

    const rows = this.db
      .query<LotRow, SQLQueryBindings[]>(`SELECT * FROM lots WHERE ${clauses.join(" AND ")} ORDER BY ${orderBy}`)
      .all(...params);
    return rows.map(mapRow);
  }

  distinctFacetValues(auctionId: number, column: "category" | "material" | "mint" | "ruler" | "denomination"): string[] {
    const rows = this.db
      .query<{ value: string }, [number]>(
        `SELECT DISTINCT ${column} AS value FROM lots WHERE auction_id = ? AND ${column} IS NOT NULL ORDER BY ${column}`,
      )
      .all(auctionId);
    return rows.map((r) => r.value);
  }

  search(
    term: string,
    filters: { auctionId?: number; limit?: number } = {},
  ): Array<Lot & { auctionTitle: string | null }> {
    const limit = filters.limit ?? 100;
    const clauses = ["lots_fts MATCH ?"];
    const params: SQLQueryBindings[] = [ftsQuery(term)];
    if (filters.auctionId !== undefined) {
      clauses.push("l.auction_id = ?");
      params.push(filters.auctionId);
    }
    const rows = this.db
      .query<LotRow & { auction_title: string | null }, SQLQueryBindings[]>(
        `SELECT l.*, a.title AS auction_title
         FROM lots_fts
         JOIN lots l ON l.id = lots_fts.rowid
         JOIN auctions a ON a.id = l.auction_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...params, limit);
    return rows.map((row) => ({ ...mapRow(row), auctionTitle: row.auction_title }));
  }
}

function ftsQuery(term: string): string {
  const cleaned = term.trim().replace(/["]/g, "");
  if (!cleaned) return '""';
  return cleaned
    .split(/\s+/)
    .map((word) => `${JSON.stringify(word)}*`)
    .join(" ");
}
