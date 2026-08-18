import type { Database } from "bun:sqlite";
import type { LotImage } from "../../domain/image.ts";
import type { ExtractedImage } from "../../domain/lot.ts";

interface ImageRow {
  id: number;
  lot_id: number;
  source_url: string;
  local_path: string | null;
  image_order: number;
  width: number | null;
  height: number | null;
  downloaded_at: string | null;
}

function mapRow(row: ImageRow): LotImage {
  return {
    id: row.id,
    lotId: row.lot_id,
    sourceUrl: row.source_url,
    localPath: row.local_path,
    imageOrder: row.image_order,
    width: row.width,
    height: row.height,
    downloadedAt: row.downloaded_at,
  };
}

export class ImageRepository {
  constructor(private readonly db: Database) {}

  listForLot(lotId: number): LotImage[] {
    const rows = this.db
      .query<ImageRow, [number]>("SELECT * FROM images WHERE lot_id = ? ORDER BY image_order ASC")
      .all(lotId);
    return rows.map(mapRow);
  }

  /**
   * Replaces a lot's image set (listing/detail re-scrapes are the source of truth for ordering),
   * while preserving any already-downloaded local_path for images whose source URL is unchanged.
   */
  replaceForLot(lotId: number, images: ExtractedImage[]): void {
    this.db.transaction(() => {
      const previousLocalPaths = new Map(
        this.listForLot(lotId)
          .filter((img) => img.localPath)
          .map((img) => [img.sourceUrl, img.localPath as string]),
      );
      this.db.query("DELETE FROM images WHERE lot_id = ?").run(lotId);
      const insert = this.db.query(
        "INSERT INTO images (lot_id, source_url, image_order, width, height, local_path, downloaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const image of images) {
        const localPath = previousLocalPaths.get(image.sourceUrl) ?? null;
        insert.run(lotId, image.sourceUrl, image.order, image.width, image.height, localPath, localPath ? new Date().toISOString() : null);
      }
    })();
  }

  setLocalPath(imageId: number, localPath: string): void {
    this.db
      .query("UPDATE images SET local_path = ?, downloaded_at = ? WHERE id = ?")
      .run(localPath, new Date().toISOString(), imageId);
  }

  findById(id: number): LotImage | null {
    const row = this.db.query<ImageRow, [number]>("SELECT * FROM images WHERE id = ?").get(id);
    return row ? mapRow(row) : null;
  }
}
