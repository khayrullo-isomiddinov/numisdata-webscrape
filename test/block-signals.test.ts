import { describe, expect, test } from "bun:test";
import { looksBlocked } from "../src/acquisition/block-signals.ts";

describe("looksBlocked", () => {
  test("detects real interstitial phrasing", () => {
    expect(looksBlocked("<html><body>Checking your browser before accessing example.com</body></html>")).toBe(true);
    expect(looksBlocked("<html><body>Please verify you are human to continue</body></html>")).toBe(true);
    expect(looksBlocked("<html><title>Just a moment...</title></html>")).toBe(true);
    expect(looksBlocked("<html><body>We have detected unusual traffic from your network</body></html>")).toBe(true);
  });

  test("does not flag a routine Cloudflare background script as a challenge page (numisbids.com false positive, confirmed live)", () => {
    const html = `<html><body>
      <div>Real page content, thousands of characters of legitimate auction data...</div>
      <script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>
      <script>window.__CF$cv$params={r:'a2e37f80fa0d026a',t:'MTc4NzI1MDkyOA==',u:'01a02074ede37ad2b823d78707challenge-platform-token'};</script>
    </body></html>`;
    expect(looksBlocked(html)).toBe(false);
  });

  test("generic weak words (captcha, access denied) are only trusted on a small response", () => {
    const small = `<html><body>Access denied - captcha required</body></html>`;
    expect(looksBlocked(small)).toBe(true);

    const large = `<html><body>${"Real legitimate page content. ".repeat(1000)}This page mentions captcha and access denied only in unrelated i18n strings.</body></html>`;
    expect(looksBlocked(large)).toBe(false);
  });

  test("a normal page with no block signals at all is not flagged", () => {
    expect(looksBlocked("<html><body><h1>Auction 466</h1><p>Lot 2001: a coin.</p></body></html>")).toBe(false);
  });
});
