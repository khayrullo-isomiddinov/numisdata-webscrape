import { getDb } from "../../database/schema.ts";
import { AuctionRepository } from "../../database/repositories/auction-repository.ts";
import { LotRepository } from "../../database/repositories/lot-repository.ts";
import { ImageRepository } from "../../database/repositories/image-repository.ts";
import { fetchPublicPage } from "../../acquisition/http.ts";
import { parseLotDetail } from "../../extraction/lot-parser.ts";
import type { Lot } from "../../domain/lot.ts";
import type { LotImage } from "../../domain/image.ts";

/**
 * Full per-lot detail (weight, composition, untruncated description, full image carousel) only
 * lives on Biddr's individual lot pages. Fetching all of those during the initial auction
 * retrieval would mean hundreds of extra requests per auction, which conflicts with "don't
 * aggressively crawl Biddr". Instead we fetch a lot's detail page lazily, the first time it's
 * actually opened in the archive, and persist the result so it's never re-fetched after that.
 */
export async function ensureLotDetail(lotId: number): Promise<{ lot: Lot; images: LotImage[]; detailFetchError: string | null }> {
  const db = getDb();
  const lots = new LotRepository(db);
  const images = new ImageRepository(db);
  const auctions = new AuctionRepository(db);

  const lot = lots.findById(lotId);
  if (!lot) throw new Error("Lot not found.");

  if (lot.detailFetched || !lot.sourceUrl) {
    return { lot, images: images.listForLot(lot.id), detailFetchError: null };
  }

  try {
    const raw = await fetchPublicPage(lot.sourceUrl);
    const extracted = parseLotDetail(raw.html, lot.sourceUrl);
    if (!extracted) {
      return { lot, images: images.listForLot(lot.id), detailFetchError: "Lot detail page could not be parsed." };
    }
    const updated = lots.upsert(lot.auctionId, extracted);
    if (extracted.images.length > 0) {
      images.replaceForLot(updated.id, extracted.images);
    }
    auctions.touchUpdatedAt(lot.auctionId);
    return { lot: updated, images: images.listForLot(updated.id), detailFetchError: null };
  } catch (err) {
    // Best-effort enrichment: if it fails (blocked, timeout, ...) still show what we have.
    return {
      lot,
      images: images.listForLot(lot.id),
      detailFetchError: err instanceof Error ? err.message : String(err),
    };
  }
}
