import type { Database } from "bun:sqlite";
import type { AcquisitionMethod, AcquisitionRun, AcquisitionStatus } from "../../domain/image.ts";

interface RunRow {
  id: number;
  url: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  acquisition_method: string;
  error_message: string | null;
  raw_file_path: string | null;
  auction_id: number | null;
}

function mapRow(row: RunRow): AcquisitionRun {
  return {
    id: row.id,
    url: row.url,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status as AcquisitionStatus,
    acquisitionMethod: row.acquisition_method as AcquisitionMethod,
    errorMessage: row.error_message,
    rawFilePath: row.raw_file_path,
  };
}

export class AcquisitionRunRepository {
  constructor(private readonly db: Database) {}

  start(url: string, method: AcquisitionMethod): number {
    const result = this.db
      .query("INSERT INTO acquisition_runs (url, started_at, status, acquisition_method) VALUES (?, ?, 'success', ?)")
      .run(url, new Date().toISOString(), method);
    return Number(result.lastInsertRowid);
  }

  complete(
    id: number,
    fields: { status: AcquisitionStatus; rawFilePath: string | null; auctionId: number | null; errorMessage?: string | null },
  ): void {
    this.db
      .query(
        "UPDATE acquisition_runs SET completed_at = ?, status = ?, raw_file_path = ?, auction_id = ?, error_message = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), fields.status, fields.rawFilePath, fields.auctionId, fields.errorMessage ?? null, id);
  }

  findById(id: number): AcquisitionRun | null {
    const row = this.db.query<RunRow, [number]>("SELECT * FROM acquisition_runs WHERE id = ?").get(id);
    return row ? mapRow(row) : null;
  }

  listForAuction(auctionId: number): AcquisitionRun[] {
    const rows = this.db
      .query<RunRow, [number]>("SELECT * FROM acquisition_runs WHERE auction_id = ? ORDER BY started_at DESC")
      .all(auctionId);
    return rows.map(mapRow);
  }
}
