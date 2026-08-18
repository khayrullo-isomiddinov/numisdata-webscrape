import { assertSafeBiddrUrl, assertNotPrivateHost } from "./url-safety.ts";
import { getCrawlDelayMs, isAllowedByRobots, USER_AGENT } from "./robots.ts";
import { waitForTurn } from "./rate-limit.ts";

export interface RawSource {
  html: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string | null;
}

export class AcquisitionBlockedError extends Error {
  constructor(message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "AcquisitionBlockedError";
  }
}

export class RobotsDisallowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RobotsDisallowedError";
  }
}

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20MB - generous for a catalogue page, still bounded.
const REQUEST_TIMEOUT_MS = 20_000;

const BLOCK_SIGNALS = [
  /captcha/i,
  /are you a human/i,
  /access denied/i,
  /cloudflare.*(checking|challenge)/i,
  /just a moment/i,
  /unusual traffic/i,
  /forbidden/i,
];

/**
 * Performs a conservative, identifiable HTTP GET against a public Biddr URL: https-only,
 * SSRF-checked (including on every redirect hop), robots.txt-respecting, rate-limited to the
 * site's own Crawl-delay, size- and time-bounded. Throws AcquisitionBlockedError if the response
 * looks like a CAPTCHA/bot-block/access wall rather than a normal page - callers must not retry
 * around that, only report it and offer the manual-import fallback.
 */
export async function fetchPublicPage(rawUrl: string): Promise<RawSource> {
  let currentUrl = assertSafeBiddrUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const allowed = await isAllowedByRobots(currentUrl);
    if (!allowed) {
      throw new RobotsDisallowedError(`robots.txt disallows fetching ${currentUrl.pathname}`);
    }

    const crawlDelay = await getCrawlDelayMs(currentUrl);
    await waitForTurn(currentUrl.hostname, crawlDelay ?? undefined);

    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new AcquisitionBlockedError("Redirected without a Location header.", response.status);
      }
      const nextUrl = new URL(location, currentUrl);
      assertNotPrivateHost(nextUrl.hostname);
      if (nextUrl.hostname !== "biddr.com" && !nextUrl.hostname.endsWith(".biddr.com")) {
        throw new AcquisitionBlockedError("Redirected off biddr.com; refusing to follow.", response.status);
      }
      currentUrl = nextUrl;
      continue;
    }

    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new AcquisitionBlockedError(
        "Automatic retrieval could not safely access this page.",
        response.status,
      );
    }

    if (!response.ok) {
      throw new AcquisitionBlockedError(`Server returned HTTP ${response.status}.`, response.status);
    }

    const contentType = response.headers.get("content-type");
    const html = await readBodyWithLimit(response, MAX_BODY_BYTES);

    if (BLOCK_SIGNALS.some((pattern) => pattern.test(html.slice(0, 20_000)))) {
      throw new AcquisitionBlockedError("The page appears to present a CAPTCHA or access restriction.");
    }

    return { html, finalUrl: currentUrl.toString(), httpStatus: response.status, contentType };
  }

  throw new AcquisitionBlockedError("Too many redirects.");
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
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
        throw new AcquisitionBlockedError("Response body exceeded the size limit.");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}
