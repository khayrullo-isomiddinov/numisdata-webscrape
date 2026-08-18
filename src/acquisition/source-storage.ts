import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PARSER_VERSION } from "../extraction/parser-utils.ts";
import type { AcquisitionMethod } from "../domain/image.ts";

const SOURCES_ROOT = join(process.cwd(), "data", "sources", "auctions");

export interface SavedPage {
  file: string;
  sha256: string;
  bytes: number;
}

export interface SourceMetadata {
  originalUrl: string;
  retrievedAt: string;
  acquisitionMethod: AcquisitionMethod;
  httpStatus: number | null;
  contentType: string | null;
  parserVersion: string;
  pages: SavedPage[];
}

/**
 * auction_identifier is Biddr's own numeric auction id (the `a` query param), which is unique
 * per auction across the whole site regardless of which seller's slug prefixes the URL - safe
 * to use directly as a directory name (digits only, never attacker-controlled path segments).
 */
function directoryFor(auctionIdentifier: string): string {
  const safe = auctionIdentifier.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid auction identifier for source storage.");
  return join(SOURCES_ROOT, safe);
}

export async function saveSourcePages(
  auctionIdentifier: string,
  pages: Array<{ html: string; label: string }>,
  info: { originalUrl: string; acquisitionMethod: AcquisitionMethod; httpStatus: number | null; contentType: string | null },
): Promise<{ dir: string; metadata: SourceMetadata }> {
  const dir = directoryFor(auctionIdentifier);
  await mkdir(dir, { recursive: true });

  const saved: SavedPage[] = [];
  for (const page of pages) {
    const filename = `${page.label}.html`;
    await writeFile(join(dir, filename), page.html, "utf-8");
    saved.push({
      file: filename,
      sha256: createHash("sha256").update(page.html, "utf-8").digest("hex"),
      bytes: Buffer.byteLength(page.html, "utf-8"),
    });
  }

  const metadata: SourceMetadata = {
    originalUrl: info.originalUrl,
    retrievedAt: new Date().toISOString(),
    acquisitionMethod: info.acquisitionMethod,
    httpStatus: info.httpStatus,
    contentType: info.contentType,
    parserVersion: PARSER_VERSION,
    pages: saved,
  };
  await writeFile(join(dir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

  return { dir, metadata };
}

export async function loadSavedSource(auctionIdentifier: string): Promise<{ metadata: SourceMetadata; pages: string[] } | null> {
  const dir = directoryFor(auctionIdentifier);
  try {
    const metadataRaw = await readFile(join(dir, "metadata.json"), "utf-8");
    const metadata = JSON.parse(metadataRaw) as SourceMetadata;
    const pages = await Promise.all(metadata.pages.map((p) => readFile(join(dir, p.file), "utf-8")));
    return { metadata, pages };
  } catch {
    return null;
  }
}

export async function hasSavedSource(auctionIdentifier: string): Promise<boolean> {
  const dir = directoryFor(auctionIdentifier);
  try {
    const entries = await readdir(dir);
    return entries.includes("metadata.json");
  } catch {
    return false;
  }
}

export function sourceDirFor(auctionIdentifier: string): string {
  return directoryFor(auctionIdentifier);
}
