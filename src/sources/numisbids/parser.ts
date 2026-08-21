import * as cheerio from "cheerio";
import type { AuctionStatus, ExtractedAuction } from "../../domain/auction.ts";
import type { ExtractedImage, ExtractedLot } from "../../domain/lot.ts";
import { numisbidsLotIdentifier, numisbidsSearchIdentifier, parseNumisbidsSaleId } from "./acquisition.ts";
import {
  cleanMultilineText,
  cleanText,
  extractDenomination,
  extractDiameter,
  extractMaterial,
  extractRulerAndDate,
  extractWeight,
  parsePrice,
  stripDigitGroupingSpaces,
} from "../../extraction/parser-utils.ts";

function absoluteUrl(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * cheerio's plain `.text()` concatenates text nodes with nothing between them, so markup like
 * `Lot 3001<br><a>Bid on this lot...</a>` (confirmed live in numisbids' own detail-page markup,
 * with no whitespace around the `<br>`) collapses into "Lot 3001Bid on this lot..." - corrupting
 * both lot-number extraction and the full description. Converting `<br>` to a real newline before
 * extracting text avoids that.
 */
function textWithLineBreaks(el: cheerio.Cheerio<any>): string {
  const withBreaks = (el.html() ?? "").replace(/<br\s*\/?>/gi, "\n");
  return cheerio.load(withBreaks).root().text();
}

/** "Page 1 of 21" - a direct text scan rather than a selector, since the exact wrapping markup
 * isn't load-bearing here and this is confirmed stable across both an open and a closed sale. */
export function parseNumisbidsTotalPages(html: string): number {
  const match = html.match(/Page\s+\d+\s+of\s+(\d+)/i);
  return match ? Number.parseInt(match[1]!, 10) : 1;
}

interface PriceInfo {
  startingPrice: number | null;
  realizedPrice: number | null;
  currency: string | null;
  currentBid: number | null;
}

/**
 * numisbids.com always shows "Starting price: N CUR" for a lot regardless of sale state - the
 * closed/open signal lives in a separate, independently-present piece of text: "Price realized:
 * N CUR" or literally "Lot unsold" once a sale has closed. Confirmed live that both starting price
 * and price realized appear together once a lot has sold (same convention as Biddr's own detail
 * parser, which keeps both fields rather than letting one overwrite the other), and confirmed on
 * an in-progress lot that "Current bid: N CUR" can appear alongside "Starting price" too - not a
 * final price, so it doesn't fit startingPrice/realizedPrice and is kept separately. Matched by
 * text rather than exact nesting, since the listing card splits this across two containers
 * (`.browsetext-top .right` for starting price, `.browsetext .bottom .right` for realized/unsold)
 * while the detail page has all of it in one. Large amounts use a narrow-no-break-space thousands
 * separator (e.g. "250 000 USD", confirmed live) - normalized up front so the "N CUR" extraction
 * regexes below don't stop at the first digit group.
 */
function extractPriceInfo(rawContainerText: string): PriceInfo {
  const containerText = stripDigitGroupingSpaces(rawContainerText);
  const startingMatch = containerText.match(/Starting price:\s*([\d.,]+\s*[A-Z]{3})/i);
  const startingParsed = startingMatch ? parsePrice(startingMatch[1]) : null;

  if (/lot unsold/i.test(containerText)) {
    return { startingPrice: startingParsed?.amount ?? null, realizedPrice: null, currency: startingParsed?.currency ?? null, currentBid: null };
  }

  const realizedMatch = containerText.match(/Price realized:\s*([\d.,]+\s*[A-Z]{3})/i);
  const realizedParsed = realizedMatch ? parsePrice(realizedMatch[1]) : null;
  const bidMatch = containerText.match(/Current bid:\s*([\d.,]+\s*[A-Z]{3})/i);
  const bidParsed = bidMatch ? parsePrice(bidMatch[1]) : null;

  return {
    startingPrice: startingParsed?.amount ?? null,
    realizedPrice: realizedParsed?.amount ?? null,
    currency: realizedParsed?.currency ?? startingParsed?.currency ?? bidParsed?.currency ?? null,
    currentBid: bidParsed?.amount ?? null,
  };
}

/** numisbids' own stable, sale-independent lot id, embedded in the watchlist link
 * (`/sales/hosted/watchlist_ajax.php?lid=NNN`) - more reliable than the sale-scoped lot number,
 * which (like jesusvico's) resets per sale. */
function extractLid(watchHref: string | undefined | null): string | null {
  const match = watchHref?.match(/[?&]lid=(\d+)/);
  return match ? match[1]! : null;
}

/**
 * Extracts auction-level metadata from a numisbids.com sale page. Status has no explicit flag -
 * instead, the whole countdown/"Session N begins closing in" block is present on an open sale and
 * absent on a closed one (confirmed live against both), cross-checked against parsed dates the
 * same defensive way jesusvico's status derivation already is.
 */
export function parseNumisbidsAuction(html: string, sourceUrl: string): ExtractedAuction {
  const $ = cheerio.load(html);
  const textBlock = $(".salestatus .text").first();

  const auctionHouse = cleanText(textBlock.find(".name").first().text());
  const title = cleanText(textBlock.find("b").first().text());

  const datesClone = textBlock.clone();
  datesClone.find(".name").remove();
  datesClone.find("b").first().remove();
  datesClone.find(".closing").remove();
  const { startDate, endDate } = parseNumisbidsDates(cleanText(datesClone.text()));

  const hasCountdown = $(".salestatus .closing").length > 0;
  const status = deriveStatus(hasCountdown, endDate);

  const saleId = parseNumisbidsSaleId(sourceUrl) ?? "";
  const lotCount = $(".browse").length;

  return {
    sourceUrl,
    sourceDomain: "numisbids.com",
    auctionIdentifier: saleId,
    auctionHouse,
    title,
    auctionNumber: null,
    description: null,
    location: null,
    startDate,
    endDate,
    status,
    lotCount: lotCount > 0 ? lotCount : null,
    categories: [],
    raw: {},
  };
}

/**
 * Builds a pseudo-auction for a single-lot URL (`/sale/{id}/lot/{n}`). Confirmed live that a lot's
 * own detail page renders the identical `.salestatus` header block a sale listing page does (same
 * house name, sale title, dates, countdown-or-not) - reuses parseNumisbidsAuction's extraction
 * wholesale, only overriding the identifier (to the lot-scoped one, see numisbidsLotIdentifier)
 * and lotCount (always 1 - the detail page has no `.browse` cards for the real count to come from).
 */
export function parseNumisbidsSingleLotAuction(html: string, sourceUrl: string): ExtractedAuction {
  const base = parseNumisbidsAuction(html, sourceUrl);
  return {
    ...base,
    auctionIdentifier: numisbidsLotIdentifier(sourceUrl) ?? base.auctionIdentifier,
    lotCount: 1,
  };
}

/**
 * Builds a pseudo-auction for a numisbids.com cross-auction search - there's no single house/date
 * to report (search spans however many real auctions matched), so this is honestly labeled as a
 * search rather than forced into a real auction's shape, the same pattern already used for Biddr
 * search.
 */
export function parseNumisbidsSearchAuction(html: string, sourceUrl: string): ExtractedAuction {
  const $ = cheerio.load(html);
  const lotCount = $(".browse").length;

  let searchTerm = "";
  try {
    searchTerm = new URL(sourceUrl).searchParams.get("searchall") ?? "";
  } catch {
    // sourceUrl is validated well before this point - defensive only.
  }

  return {
    sourceUrl,
    sourceDomain: "numisbids.com",
    auctionIdentifier: numisbidsSearchIdentifier(sourceUrl) ?? "",
    auctionHouse: "Multiple auction houses",
    title: `Search: "${searchTerm}"`,
    auctionNumber: null,
    description: null,
    location: null,
    startDate: null,
    endDate: null,
    status: "unknown",
    lotCount: lotCount > 0 ? lotCount : null,
    categories: [],
    raw: { searchTerm },
  };
}

/** "31 Aug - 5 Sep 2026" (range) or "9 Jul 2026" (single date). */
function parseNumisbidsDates(text: string | null): { startDate: string | null; endDate: string | null } {
  if (!text) return { startDate: null, endDate: null };

  const rangeMatch = text.match(/(\d{1,2}\s+[A-Za-z]+)\s*-\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  if (rangeMatch) {
    const year = rangeMatch[2]!.match(/\d{4}/)?.[0] ?? "";
    const start = new Date(`${rangeMatch[1]} ${year}`);
    const end = new Date(rangeMatch[2]!);
    return {
      startDate: Number.isNaN(start.getTime()) ? null : start.toISOString(),
      endDate: Number.isNaN(end.getTime()) ? null : end.toISOString(),
    };
  }

  const singleMatch = text.match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/);
  if (singleMatch) {
    const parsed = new Date(singleMatch[0]);
    const iso = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    return { startDate: iso, endDate: iso };
  }

  return { startDate: null, endDate: null };
}

/**
 * The printed date range (e.g. "31 Aug - 5 Sep 2026") turns out to describe when each bidding
 * session *closes*, not when the sale itself starts - confirmed live: a sale with an active
 * countdown ("Session 1 begins closing in 12 days") had a start date still in the future by that
 * same margin, meaning bidding is already open despite the printed date. So the countdown block's
 * presence is treated as authoritative for "currently open" (never downgraded to "upcoming" off
 * the start date alone); the end date is only used as a cross-check against a stale/cached
 * countdown that's already past.
 */
function deriveStatus(hasCountdown: boolean, endDate: string | null): AuctionStatus {
  if (!hasCountdown) return "closed";
  const endMs = endDate ? new Date(endDate).getTime() : NaN;
  if (!Number.isNaN(endMs) && endMs <= Date.now()) return "closed";
  return "live";
}

/**
 * Parses one `.browse` card, shared between a normal sale listing and a search-results page (same
 * card markup, confirmed live) - `categoryOverride` lets search results attach the lot's real
 * originating auction, giving the existing facet-filter UI a free grouping, the same mechanism
 * Biddr's own search integration already uses.
 */
function parseNumisbidsLotCard(card: cheerio.Cheerio<any>, sourceUrl: string, categoryOverride: string | null): ExtractedLot | null {
  const lotLink = card.find(".browsetext-top .left .lot a").first();
  const lotNumberMatch = cleanText(lotLink.text())?.match(/Lot\s+(\d+)/i);
  const lotNumber = lotNumberMatch ? lotNumberMatch[1]! : null;
  const lotUrl = absoluteUrl(lotLink.attr("href"), sourceUrl);

  const lid = extractLid(card.find("a.watchlot").first().attr("href"));
  if (!lid) return null; // no stable id available - skip rather than guess one.

  const rawTitle = cleanMultilineText(card.find(".browsetext .summary a").first().text());

  // Starting price lives under .browsetext-top .right; the closed/open signal (Price
  // realized / Lot unsold) lives separately under .browsetext .bottom .right - combined so
  // extractPriceInfo can match either or both regardless of sale state.
  const topPriceText = cleanText(card.find(".browsetext-top .right").first().text()) ?? "";
  const bottomPriceText = cleanText(card.find(".browsetext .bottom .right").first().text()) ?? "";
  const priceInfo = extractPriceInfo(`${topPriceText} ${bottomPriceText}`);

  const fullImageHref = card.find(".browseimg a.imgenlarge_overlay").first().attr("href");
  const thumbSrc = card.find(".browseimg img").first().attr("src");
  const imageUrl = absoluteUrl(fullImageHref, sourceUrl) ?? absoluteUrl(thumbSrc, sourceUrl);
  const images: ExtractedImage[] = imageUrl ? [{ sourceUrl: imageUrl, order: 0, width: null, height: null }] : [];

  const { ruler, datePeriod } = extractRulerAndDate(rawTitle);

  return {
    sourceUrl: lotUrl,
    lotIdentifier: `numisbids:${lid}`,
    lotNumber,
    title: rawTitle,
    description: rawTitle,
    descriptionHtml: null,
    category: categoryOverride,
    estimateLow: null,
    estimateHigh: null,
    startingPrice: priceInfo.startingPrice,
    realizedPrice: priceInfo.realizedPrice,
    currency: priceInfo.currency,
    weight: extractWeight(rawTitle),
    diameter: extractDiameter(rawTitle),
    material: extractMaterial(rawTitle),
    mint: null,
    ruler,
    denomination: extractDenomination(rawTitle),
    datePeriod,
    condition: null,
    referenceNumber: null,
    detailFetched: false,
    images,
    raw: priceInfo.currentBid !== null ? { currentBid: priceInfo.currentBid } : {},
  };
}

/**
 * Extracts lot cards from a numisbids.com sale listing page (`.browse` blocks). Category isn't
 * attributable from this markup (only present in a session-grouped sidebar, not per-card) - same
 * limitation Biddr already documents, left null rather than guessed.
 */
export function parseNumisbidsLots(html: string, sourceUrl: string): ExtractedLot[] {
  const $ = cheerio.load(html);
  const lots: ExtractedLot[] = [];

  $(".browse").each((_, el) => {
    const lot = parseNumisbidsLotCard($(el), sourceUrl, null);
    if (lot) lots.push(lot);
  });

  return lots;
}

/**
 * Extracts lot cards from a numisbids.com cross-auction search page (`/searchall?searchall=...`).
 * Results are grouped by their real originating auction via sibling `.salestatus` blocks (confirmed
 * live: 10 auctions' worth of `.salestatus` + `.browse` groups on one search results page) - walks
 * both selectors together in document order (cheerio/css-select preserves it regardless of nesting
 * depth) tracking the most recent group's house + sale title and attaching it to every card that
 * follows until the next `.salestatus`.
 */
export function parseNumisbidsSearchLots(html: string, sourceUrl: string): ExtractedLot[] {
  const $ = cheerio.load(html);
  const lots: ExtractedLot[] = [];
  let currentGroup: string | null = null;

  $(".salestatus, .browse").each((_, el) => {
    const node = $(el);
    if (node.hasClass("salestatus")) {
      currentGroup = salestatusGroupLabel(node);
      return;
    }
    const lot = parseNumisbidsLotCard(node, sourceUrl, currentGroup);
    if (lot) lots.push(lot);
  });

  return lots;
}

/** "House Name - Sale Title" from a `.salestatus` block, or whichever half is present. */
function salestatusGroupLabel(salestatus: cheerio.Cheerio<any>): string | null {
  const textBlock = salestatus.find(".text").first();
  const house = cleanText(textBlock.find(".name").first().text());
  const title = cleanText(textBlock.find("b").first().text());
  if (house && title) return `${house} - ${title}`;
  return house ?? title;
}

/**
 * Parses a numisbids.com lot detail page - adds the full untruncated description and the real
 * multi-image gallery (confirmed live: the listing's description is truncated with "...", and its
 * one image is a thumbnail; the detail page has both in full).
 */
export function parseNumisbidsLotDetail(html: string, sourceUrl: string): ExtractedLot | null {
  const $ = cheerio.load(html);
  const viewlot = $(".viewlot").first();
  if (viewlot.length === 0) return null;

  const lid = extractLid(viewlot.find("a.watchlot").first().attr("href"));
  if (!lid) return null;

  const lotNumberMatch = textWithLineBreaks(viewlot.find(".viewlottext .left").first()).match(/Lot\s+(\d+)/i);
  const lotNumber = lotNumberMatch ? lotNumberMatch[1]! : null;

  // The page has two other elements sharing the "description" class (#postbid, #watchnote), both
  // empty/unrelated to the lot's own text - excluded by id rather than relying on class alone.
  const descriptionEl = $(".description")
    .filter((_, el) => {
      const id = $(el).attr("id");
      return id !== "postbid" && id !== "watchnote";
    })
    .first();
  const description = cleanMultilineText(textWithLineBreaks(descriptionEl));

  const images: ExtractedImage[] = [];
  const seen = new Set<string>();
  $(".viewlotimgnav li a[href]").each((_, el) => {
    const abs = absoluteUrl($(el).attr("href"), sourceUrl);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      images.push({ sourceUrl: abs, order: images.length, width: null, height: null });
    }
  });

  const priceText = cleanText(viewlot.find(".viewlottext .estimate").first().text()) ?? "";
  const priceInfo = extractPriceInfo(priceText);

  const { ruler, datePeriod } = extractRulerAndDate(description);

  return {
    sourceUrl,
    lotIdentifier: `numisbids:${lid}`,
    lotNumber,
    title: description,
    description,
    descriptionHtml: null,
    category: null,
    estimateLow: null,
    estimateHigh: null,
    startingPrice: priceInfo.startingPrice,
    realizedPrice: priceInfo.realizedPrice,
    currency: priceInfo.currency,
    weight: extractWeight(description),
    diameter: extractDiameter(description),
    material: extractMaterial(description),
    mint: null,
    ruler,
    denomination: extractDenomination(description),
    datePeriod,
    condition: null,
    referenceNumber: null,
    detailFetched: true,
    images,
    raw: priceInfo.currentBid !== null ? { currentBid: priceInfo.currentBid } : {},
  };
}
