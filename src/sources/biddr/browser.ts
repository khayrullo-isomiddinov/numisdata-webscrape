import { assertSafeBiddrUrl } from "../../acquisition/url-safety.ts";
import { getCrawlDelayMs } from "../../acquisition/robots.ts";
import { waitForTurn } from "../../acquisition/rate-limit.ts";
import { AcquisitionBlockedError, type RawSource } from "../../acquisition/http.ts";
import { looksBlocked } from "../../acquisition/block-signals.ts";

export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}

/**
 * Strategy B: renders the public page in a local, ordinary browser (Playwright) for the case
 * where content is client-rendered. This must behave like a normal visit - no stealth/anti-
 * detection tricks, no CAPTCHA solving. If the rendered page looks blocked, we stop immediately
 * and surface that to the caller rather than attempting to work around it.
 *
 * Playwright is an optional dependency here: if it (or its browser binaries) isn't installed,
 * we report that cleanly so the caller can fall back to the manual-import workflow instead of
 * crashing the request.
 */
export async function fetchRenderedPage(rawUrl: string): Promise<RawSource> {
  const url = assertSafeBiddrUrl(rawUrl);

  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new BrowserUnavailableError(
      "Browser-based acquisition is not installed. Run `bunx playwright install chromium` to enable it, or use the local HTML import instead.",
    );
  }

  const crawlDelay = await getCrawlDelayMs(url);
  await waitForTurn(url.hostname, crawlDelay ?? undefined);

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    const response = await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 30_000 });

    if (!response) {
      throw new AcquisitionBlockedError("The browser could not load the page.");
    }
    if ([401, 403, 429].includes(response.status())) {
      throw new AcquisitionBlockedError("Automatic retrieval could not safely access this page.", response.status());
    }

    const html = await page.content();
    if (looksBlocked(html)) {
      throw new AcquisitionBlockedError("The page appears to present a CAPTCHA or access restriction.");
    }

    return {
      html,
      finalUrl: page.url(),
      httpStatus: response.status(),
      contentType: response.headers()["content-type"] ?? null,
    };
  } finally {
    await browser.close();
  }
}
