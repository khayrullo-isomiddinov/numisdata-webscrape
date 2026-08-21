import { biddrAdapter } from "./biddr/adapter.ts";
import { sixbidAdapter } from "./sixbid/adapter.ts";
import { jesusvicoAdapter } from "./jesusvico/adapter.ts";
import { numisbidsAdapter } from "./numisbids/adapter.ts";
import { aureoAdapter } from "./aureo/adapter.ts";
import type { SourceAdapter } from "./types.ts";

/** Every source this app knows how to acquire from, tried in order against a pasted URL. Shared
 * between ingestion-service.ts (auction-level retrieve/refresh) and lot-detail-service.ts
 * (per-lot lazy detail fetch), so both dispatch through the same source list. */
export const ADAPTERS: SourceAdapter[] = [biddrAdapter, sixbidAdapter, jesusvicoAdapter, numisbidsAdapter, aureoAdapter];

export function selectAdapterByUrl(rawUrl: string): SourceAdapter | null {
  return ADAPTERS.find((a) => a.matchesUrl(rawUrl)) ?? null;
}
