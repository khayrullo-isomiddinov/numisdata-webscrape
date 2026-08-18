import * as cheerio from "cheerio";
import type { AuctionStatus, ExtractedAuction } from "../domain/auction.ts";
import { cleanText, getQueryParam, parseBiddrDateText } from "./parser-utils.ts";

export interface AuctionParseInput {
  html: string;
  sourceUrl: string;
}

/**
 * Extracts auction-level metadata from a Biddr auction catalogue page.
 *
 * Biddr does not expose auction/lot data as JSON-LD or embedded application state (verified
 * against live fixtures) - it is server-rendered semantic HTML with stable class names shared
 * across auction houses (`.catalog-title`, `.catalog-timetable`, `.all-lots`, ...). We rely on
 * those classes rather than brittle positional selectors, and fall back to OpenGraph metadata
 * for title/image when present.
 */
export function parseAuction({ html, sourceUrl }: AuctionParseInput): ExtractedAuction {
  const $ = cheerio.load(html);

  const auctionIdentifier = getQueryParam(sourceUrl, "a") ?? "";
  const sourceDomain = safeHostname(sourceUrl);

  const title = cleanText($(".catalog-title h1").first().text()) ?? cleanText($('meta[property="og:title"]').attr("content"));
  const auctionHouse = cleanText($(".catalog-title a").first().text());
  const description = cleanText($(".catalog-description").first().text());

  const auctionNumberMatch = title?.match(/(\d+)/);
  const auctionNumber = auctionNumberMatch ? auctionNumberMatch[1]! : null;

  const lotCountText = $(".all-lots small").first().text();
  const lotCount = lotCountText ? Number.parseInt(lotCountText.trim(), 10) : null;

  const { status, startDate, endDate } = parseTimetable($);

  const categories: ExtractedAuction["categories"] = [];
  $(".catalog-categories .list-group-item a").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const id = getQueryParam(href, "c");
    const name = cleanText($(el).text());
    const countText = cleanText($(el).next("small").text());
    if (id && name) {
      categories.push({ id, name, count: countText ? Number.parseInt(countText, 10) : null });
    }
  });

  return {
    sourceUrl,
    sourceDomain,
    auctionIdentifier,
    auctionHouse,
    title,
    auctionNumber,
    description,
    location: null, // Not present in publicly visible catalogue markup; left for future enrichment.
    startDate,
    endDate,
    status,
    lotCount: Number.isFinite(lotCount) ? lotCount : null,
    categories,
    raw: {
      pageTitle: cleanText($("title").text()),
      ogImage: $('meta[property="og:image"]').attr("content") ?? null,
    },
  };
}

function parseTimetable($: cheerio.CheerioAPI): { status: AuctionStatus; startDate: string | null; endDate: string | null } {
  const timetableText = $(".catalog-timetable").text();

  const isClosed = /the auction is closed/i.test(timetableText);
  const isFuture = /the auction will take place/i.test(timetableText);
  const isPast = /the auction took place/i.test(timetableText);

  let status: AuctionStatus = "unknown";
  if (isClosed) status = "closed";
  else if (isFuture) status = "upcoming";
  else if (isPast) status = "closed";

  const startDateText = cleanText(
    $(".catalog-timetable")
      .find("b")
      .filter((_, el) => /take place on/i.test($(el).text()))
      .first()
      .parent()
      .find("li")
      .first()
      .text(),
  );
  const startDate = parseBiddrDateText(startDateText);

  if (status === "upcoming" && startDate) {
    const parsed = new Date(startDate);
    status = !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now() ? "live" : "upcoming";
  }

  return { status, startDate, endDate: null };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "biddr.com";
  }
}

/** Total number of listing pages, derived from the pagination <select>. Defaults to 1. */
export function parseTotalPages(html: string): number {
  const $ = cheerio.load(html);
  let max = 1;
  $(".pagination-1 option").each((_, el) => {
    const value = Number.parseInt(($(el).text() ?? "").trim(), 10);
    if (Number.isFinite(value) && value > max) max = value;
  });
  return max;
}
