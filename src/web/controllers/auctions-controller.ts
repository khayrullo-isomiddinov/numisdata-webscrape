import { getDb } from "../../database/schema.ts";
import { AuctionRepository } from "../../database/repositories/auction-repository.ts";
import { LotRepository } from "../../database/repositories/lot-repository.ts";
import { ImageRepository } from "../../database/repositories/image-repository.ts";
import { deleteAuctionArchive, refreshAuction, reimportAuctionSource } from "../services/ingestion-service.ts";
import { json, errorResponse } from "./http-helpers.ts";
import { mediaUrl } from "../media-url.ts";
import type { Lot } from "../../domain/lot.ts";

function serializeLotSummary(lot: Lot, images: ReturnType<ImageRepository["listForLot"]>) {
  return {
    id: lot.id,
    lotIdentifier: lot.lotIdentifier,
    lotNumber: lot.lotNumber,
    title: lot.title,
    category: lot.category,
    estimateLow: lot.estimateLow,
    estimateHigh: lot.estimateHigh,
    startingPrice: lot.startingPrice,
    realizedPrice: lot.realizedPrice,
    currency: lot.currency,
    weight: lot.weight,
    diameter: lot.diameter,
    material: lot.material,
    mint: lot.mint,
    ruler: lot.ruler,
    denomination: lot.denomination,
    datePeriod: lot.datePeriod,
    thumbnailUrl: mediaUrl(images[0]?.localPath ?? null) ?? images[0]?.sourceUrl ?? null,
  };
}

export async function handleListAuctions(_req: Request): Promise<Response> {
  const db = getDb();
  const auctions = new AuctionRepository(db).list();
  return json({
    auctions: auctions.map((a) => ({
      id: a.id,
      title: a.title,
      auctionHouse: a.auctionHouse,
      auctionNumber: a.auctionNumber,
      status: a.status,
      startDate: a.startDate,
      lotCount: a.lotCountActual,
      importedAt: a.importedAt,
      sourceUrl: a.sourceUrl,
    })),
  });
}

export async function handleGetAuction(req: Request & { params: { id: string } }): Promise<Response> {
  const db = getDb();
  const auctions = new AuctionRepository(db);
  const lots = new LotRepository(db);
  const auction = auctions.findById(Number(req.params.id));
  if (!auction) return json({ error: "Auction not found." }, 404);

  const url = new URL(req.url);
  const filters = {
    category: url.searchParams.get("category") ?? undefined,
    material: url.searchParams.get("material") ?? undefined,
    mint: url.searchParams.get("mint") ?? undefined,
    ruler: url.searchParams.get("ruler") ?? undefined,
    denomination: url.searchParams.get("denomination") ?? undefined,
    priceMin: url.searchParams.get("priceMin") ? Number(url.searchParams.get("priceMin")) : undefined,
    priceMax: url.searchParams.get("priceMax") ? Number(url.searchParams.get("priceMax")) : undefined,
    sort: (url.searchParams.get("sort") as any) ?? undefined,
  };

  const images = new ImageRepository(db);
  const lotRows = lots.listForAuction(auction.id, filters);
  const lotSummaries = lotRows.map((lot) => serializeLotSummary(lot, images.listForLot(lot.id)));

  return json({
    auction: {
      id: auction.id,
      sourceUrl: auction.sourceUrl,
      sourceDomain: auction.sourceDomain,
      auctionIdentifier: auction.auctionIdentifier,
      auctionHouse: auction.auctionHouse,
      title: auction.title,
      auctionNumber: auction.auctionNumber,
      description: auction.description,
      location: auction.location,
      startDate: auction.startDate,
      status: auction.status,
      lotCount: lotRows.length,
      importedAt: auction.importedAt,
      updatedAt: auction.updatedAt,
      acquisitionMethod: auction.acquisitionMethod,
    },
    lots: lotSummaries,
    facets: {
      category: lots.distinctFacetValues(auction.id, "category"),
      material: lots.distinctFacetValues(auction.id, "material"),
      mint: lots.distinctFacetValues(auction.id, "mint"),
      ruler: lots.distinctFacetValues(auction.id, "ruler"),
      denomination: lots.distinctFacetValues(auction.id, "denomination"),
    },
  });
}

export async function handleRefreshAuction(req: Request & { params: { id: string } }): Promise<Response> {
  try {
    const result = await refreshAuction(Number(req.params.id));
    return json({ auctionId: result.auction.id, lotCount: result.lotCount });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleReimportAuction(req: Request & { params: { id: string } }): Promise<Response> {
  try {
    const result = await reimportAuctionSource(Number(req.params.id));
    return json({ auctionId: result.auction.id, lotCount: result.lotCount });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/auctions/:id - permanently removes the whole auction: its database rows and every file on disk (raw source snapshot + any downloaded images). */
export async function handleDeleteAuction(req: Request & { params: { id: string } }): Promise<Response> {
  try {
    await deleteAuctionArchive(Number(req.params.id));
    return json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/auctions/:id/lots/delete - permanently removes exactly the given lots (and their images) from this auction. */
export async function handleDeleteLots(req: Request & { params: { id: string } }): Promise<Response> {
  const auctionId = Number(req.params.id);
  const db = getDb();
  const auctions = new AuctionRepository(db);
  const auction = auctions.findById(auctionId);
  if (!auction) return json({ error: "Auction not found." }, 404);

  let body: { lotIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body with a lotIds array." }, 400);
  }

  if (!Array.isArray(body.lotIds) || !body.lotIds.every((id) => typeof id === "number" && Number.isInteger(id))) {
    return json({ error: "lotIds must be an array of integers." }, 400);
  }

  const lots = new LotRepository(db);
  const deleted = lots.deleteByIds(auctionId, body.lotIds);
  auctions.touchUpdatedAt(auctionId);

  return json({ deleted, remaining: lots.listForAuction(auctionId).length });
}
