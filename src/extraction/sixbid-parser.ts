import type { AuctionStatus, ExtractedAuction } from "../domain/auction.ts";
import type { ExtractedImage, ExtractedLot } from "../domain/lot.ts";
import {
  cleanMultilineText,
  cleanText,
  extractDenomination,
  extractDiameter,
  extractMaterial,
  extractRulerAndDate,
  extractWeight,
} from "./parser-utils.ts";
import { sixbidImageUrl } from "./image-parser.ts";

interface SixbidLotItem {
  companySlug: string;
  companyName: string | null;
  auctionId: number;
  auctionName: string | null;
  auctionDescription: string | null;
  auctionStart: string | null;
  auctionEnd: string | null;
  auctionOnlineEnd: string | null;
  auctionCurrency: string | null;
  auctionSlug: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  lotId: number;
  lotNumber: number | string;
  lotNumberAffix: string | null;
  lotSlug: string | null;
  lotDescription: string | null;
  lotShortDescription: string | null;
  lotEstimate: number | null;
  lotStartingPrice: number | null;
  lotPriceRealised: number | null;
  googleBucketImagePath: string | null;
  hasImage: number;
}

interface SixbidApiPage {
  total_items: number;
  items: SixbidLotItem[];
}

function parsePage(rawJson: string): SixbidApiPage {
  return JSON.parse(rawJson) as SixbidApiPage;
}

/**
 * sixbid's `auctionStatus` field exists but its enum values weren't confirmed from live sampling
 * - rather than guess, derive status from dates the same way auction-parser.ts's parseTimetable
 * does for Biddr.
 */
function deriveStatus(startDate: string | null, endDate: string | null): AuctionStatus {
  const now = Date.now();
  const start = startDate ? new Date(startDate).getTime() : NaN;
  const end = endDate ? new Date(endDate).getTime() : NaN;
  if (!Number.isNaN(end) && end <= now) return "closed";
  if (!Number.isNaN(start) && start > now) return "upcoming";
  if (!Number.isNaN(start) || !Number.isNaN(end)) return "live";
  return "unknown";
}

function toIso(dateText: string | null | undefined): string | null {
  if (!dateText) return null;
  const parsed = new Date(dateText.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Extracts auction-level metadata from a sixbid lots-API page. Unlike Biddr (where auction
 * metadata and lot listings come from the same server-rendered HTML page), sixbid's JSON API
 * denormalizes the auction's fields onto every lot item - we just read them off the first one.
 */
export function parseSixbidAuction(rawJson: string, sourceUrl: string): ExtractedAuction {
  const page = parsePage(rawJson);
  const first = page.items[0];
  if (!first) {
    return {
      sourceUrl,
      sourceDomain: "sixbid.com",
      auctionIdentifier: "",
      auctionHouse: null,
      title: null,
      auctionNumber: null,
      description: null,
      location: null,
      startDate: null,
      endDate: null,
      status: "unknown",
      lotCount: page.total_items ?? 0,
      categories: [],
      raw: {},
    };
  }

  const startDate = toIso(first.auctionStart);
  const endDate = toIso(first.auctionOnlineEnd ?? first.auctionEnd);
  const auctionNumberMatch = first.auctionName?.match(/(\d+)/);

  return {
    sourceUrl,
    sourceDomain: "sixbid.com",
    auctionIdentifier: String(first.auctionId),
    auctionHouse: cleanText(first.companyName),
    title: cleanText(first.auctionName),
    auctionNumber: auctionNumberMatch ? auctionNumberMatch[1]! : null,
    description: cleanText(first.auctionDescription),
    location: null,
    startDate,
    endDate,
    status: deriveStatus(startDate, endDate),
    lotCount: page.total_items ?? null,
    categories: [],
    raw: { companySlug: first.companySlug, auctionSlug: first.auctionSlug },
  };
}

/**
 * Extracts every lot from one sixbid lots-API page. The API already provides full per-lot detail
 * (unlike Biddr, no separate lot-detail-page fetch is needed) - detailFetched is always true, so
 * lot-detail-service.ts's ensureLotDetail short-circuits automatically for these lots.
 */
export function parseSixbidLots(rawJson: string): ExtractedLot[] {
  const page = parsePage(rawJson);
  return page.items.map((item) => {
    const description = cleanMultilineText(item.lotDescription);
    const title = cleanText(item.lotShortDescription) ?? description;

    const images: ExtractedImage[] = [];
    if (item.hasImage && item.googleBucketImagePath) {
      images.push({ sourceUrl: sixbidImageUrl(item.googleBucketImagePath, "o"), order: 0, width: null, height: null });
    }

    const { ruler, datePeriod } = extractRulerAndDate(title);
    // lotEstimate uses 0 to mean "no estimate given" (observed on lots with no traditional
    // estimate range) rather than a literal $0 estimate.
    const estimate = item.lotEstimate && item.lotEstimate > 0 ? item.lotEstimate : null;

    const lot: ExtractedLot = {
      // sixbid's API doesn't expose a confirmed per-lot detail-page URL pattern - leaving this
      // null (rather than guessing one) means the UI simply omits the "view original" link for
      // these lots instead of risking a broken one.
      sourceUrl: null,
      lotIdentifier: `sixbid:${item.lotId}`,
      lotNumber: `${item.lotNumber}${item.lotNumberAffix ?? ""}`,
      title,
      description,
      descriptionHtml: null,
      category: cleanText(item.categoryName),
      estimateLow: estimate,
      estimateHigh: estimate,
      startingPrice: item.lotStartingPrice ?? null,
      realizedPrice: item.lotPriceRealised ?? null,
      currency: item.auctionCurrency ?? null,
      weight: extractWeight(description),
      diameter: extractDiameter(description),
      material: extractMaterial(description),
      mint: null,
      ruler,
      denomination: extractDenomination(description ?? title),
      datePeriod,
      condition: null,
      referenceNumber: null,
      detailFetched: true,
      images,
      raw: {
        companySlug: item.companySlug,
        auctionSlug: item.auctionSlug,
        lotSlug: item.lotSlug,
        categorySlug: item.categorySlug,
      },
    };
    return lot;
  });
}
