import { IngestionError } from "../services/ingestion-service.ts";
import { PARSER_VERSION } from "../../extraction/parser-utils.ts";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

const KIND_TO_STATUS: Record<string, number> = {
  "invalid-url": 400,
  blocked: 502,
  unsupported: 422,
  "not-found": 404,
  "invalid-import": 400,
  internal: 500,
};

/**
 * Maps a caught error to a user-safe JSON error response. The `error` field is always a short,
 * understandable message (never a raw stack trace or internal detail); a separate `diagnostic`
 * object carries developer-facing context (url, parser version, reason) per the spec's error
 * handling requirements, without leaking internals into the primary message.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof IngestionError) {
    return json(
      {
        error: err.message,
        diagnostic: { kind: err.kind, parserVersion: PARSER_VERSION, ...err.diagnostic },
      },
      KIND_TO_STATUS[err.kind] ?? 500,
    );
  }
  console.error(err);
  return json({ error: "An unexpected error occurred.", diagnostic: { reason: err instanceof Error ? err.message : String(err) } }, 500);
}
