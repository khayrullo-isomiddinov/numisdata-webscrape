import * as cheerio from "cheerio";
import type { ExtractedImage, ExtractedLot } from "../domain/lot.ts";
import {
  cleanMultilineText,
  cleanText,
  extractDenomination,
  extractDiameter,
  extractMaterial,
  extractRulerAndDate,
  extractWeight,
  parsePrice,
  parsePriceRange,
} from "./parser-utils.ts";

function absoluteUrl(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function lotNumberFromTitle(title: string | null): string | null {
  if (!title) return null;
  const match = title.match(/^Lot\s+(\d+)/i);
  return match ? match[1]! : null;
}

/**
 * Extracts lot cards from a Biddr catalogue listing page (`.catalog-lot` blocks). Listing cards
 * carry a truncated description, one thumbnail image, and a single price field whose label
 * ("Starting price" vs "Price realized") tells us the auction's state.
 */
export function parseLotListing(html: string, sourceUrl: string): ExtractedLot[] {
  const $ = cheerio.load(html);
  const lots: ExtractedLot[] = [];

  $(".catalog-grid > [id^='lot']").each((_, el) => {
    const container = $(el);
    const $card = container.find(".catalog-lot").first();
    const idAttr = container.attr("id") ?? "";
    const lotIdentifier = idAttr.replace(/^lot/, "");
    if (!lotIdentifier) return;

    const linkHref = $card.find(".lot-description a").first().attr("href") ?? $card.find(".lot-image a").first().attr("href");
    const lotUrl = absoluteUrl(linkHref, sourceUrl);

    const rawTitle = cleanMultilineText($card.find(".lot-description a").first().text());
    const lotNumber = lotNumberFromTitle(rawTitle);
    const title = rawTitle ? rawTitle.replace(/^Lot\s+\d+\.\s*/i, "").trim() : null;

    const imageSrc = $card.find(".lot-image img").first().attr("src");
    const images: ExtractedImage[] = [];
    const absoluteImage = absoluteUrl(imageSrc, sourceUrl);
    if (absoluteImage) images.push({ sourceUrl: absoluteImage, order: 0, width: null, height: null });

    const priceLabel = cleanText($card.find(".lot-price").first().children().first().text());
    const priceValueText = cleanText($card.find(".lot-price").first().children().eq(1).text());
    const parsedPrice = parsePrice(priceValueText);

    let startingPrice: number | null = null;
    let realizedPrice: number | null = null;
    let currency: string | null = null;
    if (parsedPrice) {
      currency = parsedPrice.currency;
      if (priceLabel && /realized/i.test(priceLabel)) {
        realizedPrice = parsedPrice.amount;
      } else {
        startingPrice = parsedPrice.amount;
      }
    }

    const { ruler, datePeriod } = extractRulerAndDate(title);

    lots.push({
      sourceUrl: lotUrl,
      lotIdentifier,
      lotNumber,
      title,
      description: rawTitle,
      descriptionHtml: null,
      category: null,
      estimateLow: null,
      estimateHigh: null,
      startingPrice,
      realizedPrice,
      currency,
      weight: extractWeight(rawTitle),
      diameter: extractDiameter(rawTitle),
      material: extractMaterial(rawTitle),
      mint: null,
      ruler,
      denomination: extractDenomination(rawTitle ?? title),
      datePeriod,
      condition: null,
      referenceNumber: null,
      detailFetched: false,
      images,
      raw: {},
    });
  });

  return lots;
}

/**
 * Extracts full detail for a single lot from its dedicated page (`?a=...&l=...`). This page
 * carries the untruncated description (including weight/composition lines) and the full image
 * carousel, so we re-run the numismatic-field heuristics against the untruncated text.
 */
export function parseLotDetail(html: string, sourceUrl: string): ExtractedLot | null {
  const $ = cheerio.load(html);

  const lotIdMatch = sourceUrl.match(/[?&]l=(\d+)/);
  const lotIdentifier = lotIdMatch ? lotIdMatch[1]! : null;
  if (!lotIdentifier) return null;

  const lotNumberText = cleanText($(".lot-navigation h2").first().text());
  const lotNumber = lotNumberText ? (lotNumberText.match(/(\d+)/)?.[1] ?? null) : null;

  const titleText = cleanText($("title").text());
  const title = titleText
    ? cleanText(titleText.replace(/^biddr\.com\s*-\s*.*?,\s*lot\s*\d+\.\s*/i, ""))
    : null;

  const $description = $(".lot-details .lot-description").first().clone();
  $description.find(".truncatable-expand").remove();
  const descriptionHtml = $description.html();
  const description = cleanMultilineText($description.text());

  const images: ExtractedImage[] = [];
  $(".single-lot .carousel-item a[data-pswp-width]").each((i, el) => {
    const href = $(el).attr("href");
    const abs = absoluteUrl(href, sourceUrl);
    if (abs) {
      images.push({
        sourceUrl: abs,
        order: i,
        width: Number.parseInt($(el).attr("data-pswp-width") ?? "", 10) || null,
        height: Number.parseInt($(el).attr("data-pswp-height") ?? "", 10) || null,
      });
    }
  });

  const startingPriceText = cleanText($(".lot-bidding-info-starting-price .highlight-u").first().text());
  const startingPrice = parsePrice(startingPriceText)?.amount ?? null;

  const estimateLabel = $(".lot-bidding").find("*").filter((_, el) => /^Estimate$/i.test($(el).text().trim()));
  const estimateText = cleanText(estimateLabel.first().parent().find(".highlight-u").first().text());
  const estimateRange = parsePriceRange(estimateText);

  const realizedLabel = $(".lot-bidding").find("*").filter((_, el) => /price realized/i.test($(el).text()));
  const realizedText = cleanText(realizedLabel.first().closest(".hstack").find(".highlight-u, b").last().text());
  const realizedPrice = parsePrice(realizedText)?.amount ?? null;

  const currency =
    parsePrice(startingPriceText)?.currency ?? estimateRange?.currency ?? parsePrice(realizedText)?.currency ?? null;

  const { ruler, datePeriod } = extractRulerAndDate(title ?? description);

  return {
    sourceUrl,
    lotIdentifier,
    lotNumber,
    title,
    description,
    descriptionHtml: descriptionHtml ?? null,
    category: null,
    estimateLow: estimateRange?.low ?? null,
    estimateHigh: estimateRange?.high ?? null,
    startingPrice,
    realizedPrice,
    currency,
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
    raw: {},
  };
}
