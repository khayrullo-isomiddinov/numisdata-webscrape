import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const ALLOWED_HOSTS = [/^biddr\.com$/i, /^www\.biddr\.com$/i, /^media\.biddr\.com$/i, /^[a-z0-9-]+\.biddr\.com$/i];

/**
 * This is a personal archive tool for Biddr specifically, not a general-purpose fetcher, so we
 * allowlist Biddr's own hostnames rather than trying to blocklist everything unsafe. Combined
 * with an https-only + private-IP check, this closes off SSRF via crafted or redirected URLs.
 */
export function assertSafeBiddrUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Please provide a valid Biddr auction URL.");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeUrlError("Only https:// URLs are supported.");
  }

  if (!ALLOWED_HOSTS.some((pattern) => pattern.test(url.hostname))) {
    throw new UnsafeUrlError("Only biddr.com URLs are supported.");
  }

  assertNotPrivateHost(url.hostname);

  return url;
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
