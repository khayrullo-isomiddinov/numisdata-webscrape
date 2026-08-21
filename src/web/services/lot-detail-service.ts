import { getDb } from "../../database/schema.ts";
import { AuctionRepository } from "../../database/repositories/auction-repository.ts";
import { LotRepository } from "../../database/repositories/lot-repository.ts";
import { ImageRepository } from "../../database/repositories/image-repository.ts";
import { selectAdapterByUrl } from "../../sources/registry.ts";
import type { Lot } from "../../domain/lot.ts";
import type { LotImage } from "../../domain/image.ts";

/**
 * Full per-lot detail (weight, composition, untruncated description, full image carousel/gallery)
 * only lives on a source's individual lot pages for some sources (Biddr, jesusvico.com) - fetching
 * all of those during the initial auction retrieval would mean hundreds of extra requests, which
 * conflicts with "don't aggressively crawl". Instead we fetch a lot's detail page lazily, the
 * first time it's actually opened in the archive, and persist the result so it's never re-fetched
 * after that. Dispatches through the owning auction's SourceAdapter (sources/registry.ts) - a
 * source whose listing already carries everything (sixbid) sets detailFetched: true up front and
 * never reaches this function's fetch path at all.
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

  const auction = auctions.findById(lot.auctionId);
  const adapter = auction ? selectAdapterByUrl(auction.sourceUrl) : null;
  if (!adapter?.fetchLotDetail) {
    return { lot, images: images.listForLot(lot.id), detailFetchError: null };
  }

  try {
    const extracted = await adapter.fetchLotDetail(lot.sourceUrl);
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
