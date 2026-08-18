import { getDb } from "../../database/schema.ts";
import { LotRepository } from "../../database/repositories/lot-repository.ts";
import { ImageRepository } from "../../database/repositories/image-repository.ts";
import { json } from "./http-helpers.ts";
import { mediaUrl } from "../media-url.ts";

export async function handleSearch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const term = url.searchParams.get("q")?.trim() ?? "";
  if (!term) return json({ results: [] });

  const auctionIdParam = url.searchParams.get("auctionId");
  const db = getDb();
  const lots = new LotRepository(db);
  const images = new ImageRepository(db);

  const results = lots.search(term, { auctionId: auctionIdParam ? Number(auctionIdParam) : undefined, limit: 100 });

  return json({
    results: results.map((lot) => ({
      id: lot.id,
      auctionId: lot.auctionId,
      auctionTitle: lot.auctionTitle,
      lotNumber: lot.lotNumber,
      title: lot.title,
      material: lot.material,
      mint: lot.mint,
      ruler: lot.ruler,
      denomination: lot.denomination,
      startingPrice: lot.startingPrice,
      realizedPrice: lot.realizedPrice,
      currency: lot.currency,
      thumbnailUrl: (() => {
        const img = images.listForLot(lot.id)[0];
        return mediaUrl(img?.localPath ?? null) ?? img?.sourceUrl ?? null;
      })(),
    })),
  });
}
