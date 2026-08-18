import type { RawSource } from "./http.ts";

const MAX_IMPORT_BYTES = 30 * 1024 * 1024;

export class InvalidImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImportError";
  }
}

/**
 * Wraps a browser-uploaded "Save Page As..." HTML file into the same RawSource shape produced
 * by the HTTP acquisition strategy, so it can flow through the same extraction pipeline. Content
 * arrives as bytes from a multipart upload (never a server-side file path), which sidesteps path
 * traversal entirely - there is nothing for the server to resolve on disk.
 */
export function importLocalHtml(content: string, declaredSourceUrl: string | null): RawSource {
  if (content.length === 0) {
    throw new InvalidImportError("The uploaded file is empty.");
  }
  if (Buffer.byteLength(content, "utf-8") > MAX_IMPORT_BYTES) {
    throw new InvalidImportError("The uploaded file is too large.");
  }
  if (!/<html[\s>]/i.test(content) && !/<!doctype html/i.test(content)) {
    throw new InvalidImportError("The uploaded file does not look like an HTML page.");
  }

  return {
    html: content,
    finalUrl: declaredSourceUrl ?? "local-import://unknown",
    httpStatus: 0,
    contentType: "text/html",
  };
}
