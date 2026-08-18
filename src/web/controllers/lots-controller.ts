import { getDb } from "../../database/schema.ts";
import { AuctionRepository } from "../../database/repositories/auction-repository.ts";
import { ImageRepository } from "../../database/repositories/image-repository.ts";
import { ensureLotDetail } from "../services/lot-detail-service.ts";
import { downloadImage, ImageDownloadError } from "../../acquisition/image-downloader.ts";
import { json, errorResponse } from "./http-helpers.ts";
import { sanitizeDescriptionHtml } from "../sanitize.ts";
import { mediaUrl } from "../media-url.ts";

export async function handleGetLot(req: Request & { params: { id: string } }): Promise<Response> {
  const lotId = Number(req.params.id);
  if (!Number.isFinite(lotId)) return json({ error: "Invalid lot id." }, 400);

  try {
    const { lot, images, detailFetchError } = await ensureLotDetail(lotId);
    const db = getDb();
    const auction = new AuctionRepository(db).findById(lot.auctionId);

    return json({
      lot: {
        id: lot.id,
        auctionId: lot.auctionId,
        sourceUrl: lot.sourceUrl,
        lotIdentifier: lot.lotIdentifier,
        lotNumber: lot.lotNumber,
        title: lot.title,
        description: lot.description,
        descriptionHtml: sanitizeDescriptionHtml(lot.descriptionHtml),
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
        condition: lot.condition,
        referenceNumber: lot.referenceNumber,
        detailFetched: lot.detailFetched,
      },
      images: images.map((img) => ({
        id: img.id,
        sourceUrl: img.sourceUrl,
        localPath: mediaUrl(img.localPath),
        order: img.imageOrder,
        width: img.width,
        height: img.height,
      })),
      auction: auction ? { id: auction.id, title: auction.title, auctionHouse: auction.auctionHouse } : null,
      detailFetchError,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleDownloadLotImage(
  req: Request & { params: { id: string; imageId: string } },
): Promise<Response> {
  const db = getDb();
  const images = new ImageRepository(db);
  const image = images.findById(Number(req.params.imageId));
  if (!image || image.lotId !== Number(req.params.id)) {
    return json({ error: "Image not found." }, 404);
  }
  if (image.localPath) {
    return json({ localPath: image.localPath, alreadyDownloaded: true });
  }

  try {
    const lotIdentifier = String(image.lotId);
    const localPath = await downloadImage(image.sourceUrl, lotIdentifier, image.imageOrder);
    images.setLocalPath(image.id, localPath);
    return json({ localPath, alreadyDownloaded: false });
  } catch (err) {
    if (err instanceof ImageDownloadError) {
      return json({ error: err.message }, 502);
    }
    return errorResponse(err);
  }
}
