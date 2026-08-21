import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeAureoUrl, assertSafeBiddrUrl, assertSafeJesusvicoUrl, assertSafeNumisbidsUrl, assertSafeSixbidUrl } from "./url-safety.ts";
import { getCrawlDelayMs } from "./robots.ts";
import { USER_AGENT } from "./user-agent.ts";
import { waitForTurn } from "./rate-limit.ts";

const IMAGES_ROOT = join(process.cwd(), "data", "images");
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export class ImageDownloadError extends Error {}

/**
 * Mode 2 (explicit local archival) of the image handling design: downloads a single image the
 * user has asked to archive, using the same conservative fetch discipline as page acquisition
 * (https+host allowlist, rate limiting, size limit). Never used automatically/in bulk - only
 * called per-image on request, since Biddr images may carry usage restrictions the user should
 * consciously opt into archiving.
 */
export async function downloadImage(sourceUrl: string, lotIdentifier: string, order: number): Promise<string> {
  let url: URL;
  let userAgent: string;
  let crawlDelay: number | null = null;
  try {
    url = assertSafeBiddrUrl(sourceUrl);
    userAgent = USER_AGENT;
    crawlDelay = await getCrawlDelayMs(url);
  } catch {
    try {
      // jesusvico.com also respects robots.txt fully (see sources/jesusvico/acquisition.ts) -
      // same crawl-delay-aware discipline as Biddr.
      url = assertSafeJesusvicoUrl(sourceUrl);
      userAgent = USER_AGENT;
      crawlDelay = await getCrawlDelayMs(url);
    } catch {
      try {
        // aureo.com also respects robots.txt fully (see sources/aureo/acquisition.ts) - same
        // crawl-delay-aware discipline as Biddr/jesusvico.
        url = assertSafeAureoUrl(sourceUrl);
        userAgent = USER_AGENT;
        crawlDelay = await getCrawlDelayMs(url);
      } catch {
        try {
          // Not a Biddr, jesusvico, or aureo image URL - try sixbid's image-cdn host instead.
          // sixbid has no crawl-delay to read (robots.txt disallows its data hosts entirely, see
          // sources/sixbid/api.ts), so waitForTurn below falls back to its own conservative default.
          url = assertSafeSixbidUrl(sourceUrl);
          userAgent = USER_AGENT;
        } catch {
          // Not sixbid either - try numisbids' media host. Same no-crawl-delay-to-read situation as
          // sixbid (see sources/numisbids/acquisition.ts's fetchNumisbidsPage disclosure).
          url = assertSafeNumisbidsUrl(sourceUrl);
          userAgent = USER_AGENT;
        }
      }
    }
  }

  await waitForTurn(url.hostname, crawlDelay ?? undefined);

  const response = await fetch(url, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new ImageDownloadError(`Could not download image (HTTP ${response.status}).`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new ImageDownloadError("Remote content is not an image.");
  }

  const buffer = await readWithLimit(response, MAX_IMAGE_BYTES);
  const ext = extensionFor(contentType, url.pathname);
  const safeLotId = lotIdentifier.replace(/[^a-zA-Z0-9_-]/g, "");
  const dir = join(IMAGES_ROOT, safeLotId);
  await mkdir(dir, { recursive: true });
  // Stored relative to data/ (not the project root) so it maps 1:1 onto the /media/* serving route.
  const relativePath = join("images", safeLotId, `${order}${ext}`);
  await Bun.write(join(process.cwd(), "data", relativePath), buffer);
  return relativePath;
}

/** Deletes every locally-downloaded image for one lot (its whole data/images/<lotId>/ directory), if any exist. */
export async function deleteLotImages(lotId: number): Promise<void> {
  await rm(join(IMAGES_ROOT, String(lotId)), { recursive: true, force: true });
}

function extensionFor(contentType: string, pathname: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (/\.jpe?g$/i.test(pathname)) return ".jpg";
  return ".jpg";
}

async function readWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel();
        throw new ImageDownloadError("Image exceeded the size limit.");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}
