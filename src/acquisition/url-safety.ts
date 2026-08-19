import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const BIDDR_ALLOWED_HOSTS = [/^biddr\.com$/i, /^www\.biddr\.com$/i, /^media\.biddr\.com$/i, /^[a-z0-9-]+\.biddr\.com$/i];
const SIXBID_ALLOWED_HOSTS = [/^www\.sixbid\.com$/i, /^lots\.sixbid\.com$/i, /^image-cdn\.sixbid\.com$/i];

/**
 * This is a personal archive tool for a small, known set of auction sites, not a general-purpose
 * fetcher, so we allowlist each source's own hostnames rather than trying to blocklist everything
 * unsafe. Combined with an https-only + private-IP check, this closes off SSRF via crafted or
 * redirected URLs.
 */
function assertSafeKnownHost(rawUrl: string, allowedHosts: RegExp[], invalidUrlMessage: string, wrongHostMessage: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(invalidUrlMessage);
  }

  if (url.protocol !== "https:") {
    throw new UnsafeUrlError("Only https:// URLs are supported.");
  }

  if (!allowedHosts.some((pattern) => pattern.test(url.hostname))) {
    throw new UnsafeUrlError(wrongHostMessage);
  }

  assertNotPrivateHost(url.hostname);

  return url;
}

export function assertSafeBiddrUrl(rawUrl: string): URL {
  return assertSafeKnownHost(
    rawUrl,
    BIDDR_ALLOWED_HOSTS,
    "Please provide a valid Biddr auction URL.",
    "Only biddr.com URLs are supported.",
  );
}

/** Allowlists sixbid.com's browser-facing host plus the two hosts we actually fetch data/images from. */
export function assertSafeSixbidUrl(rawUrl: string): URL {
  return assertSafeKnownHost(
    rawUrl,
    SIXBID_ALLOWED_HOSTS,
    "Please provide a valid sixbid.com auction URL.",
    "Only sixbid.com URLs are supported.",
  );
}

export function assertNotPrivateHost(hostname: string): void {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new UnsafeUrlError("Local/internal addresses are not allowed.");
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 0) return; // hostname, not a literal IP - fine, allowlist already constrains it.

  // A literal IP was supplied (or a redirect resolved to one) - reject private/loopback/link-local ranges.
  if (isPrivateOrReservedIp(hostname, ipVersion)) {
    throw new UnsafeUrlError("Private/internal network addresses are not allowed.");
  }
}

function isPrivateOrReservedIp(ip: string, version: number): boolean {
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === undefined || b === undefined) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  return false;
}
