export interface ApiErrorPayload {
  error: string;
  diagnostic?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(public readonly payload: ApiErrorPayload, public readonly status: number) {
    super(payload.error);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data as ApiErrorPayload, response.status);
  }
  return data as T;
}

export interface AuctionSummary {
  id: number;
  title: string | null;
  auctionHouse: string | null;
  auctionNumber: string | null;
  status: string;
  startDate: string | null;
  lotCount: number;
  importedAt: string;
  sourceUrl: string;
}

export interface LotSummary {
  id: number;
  lotIdentifier: string;
  lotNumber: string | null;
  title: string | null;
  category: string | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  startingPrice: number | null;
  realizedPrice: number | null;
  currency: string | null;
  weight: string | null;
  diameter: string | null;
  material: string | null;
  mint: string | null;
  ruler: string | null;
  denomination: string | null;
  datePeriod: string | null;
  thumbnailUrl: string | null;
}

export interface AuctionDetail {
  id: number;
  sourceUrl: string;
  sourceDomain: string;
  auctionIdentifier: string;
  auctionHouse: string | null;
  title: string | null;
  auctionNumber: string | null;
  description: string | null;
  location: string | null;
  startDate: string | null;
  status: string;
  lotCount: number;
  importedAt: string;
  updatedAt: string;
  acquisitionMethod: string;
}

export interface Facets {
  category: string[];
  material: string[];
  mint: string[];
  ruler: string[];
  denomination: string[];
}

export interface LotDetail {
  id: number;
  auctionId: number;
  sourceUrl: string | null;
  lotIdentifier: string;
  lotNumber: string | null;
  title: string | null;
  description: string | null;
  descriptionHtml: string | null;
  category: string | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  startingPrice: number | null;
  realizedPrice: number | null;
  currency: string | null;
  weight: string | null;
  diameter: string | null;
  material: string | null;
  mint: string | null;
  ruler: string | null;
  denomination: string | null;
  datePeriod: string | null;
  condition: string | null;
  referenceNumber: string | null;
  detailFetched: boolean;
}

export interface LotImageDto {
  id: number;
  sourceUrl: string;
  localPath: string | null;
  order: number;
  width: number | null;
  height: number | null;
}

export interface AcquisitionRunDto {
  id: number;
  status: "success" | "blocked" | "failed" | "unsupported";
  completedAt: string | null;
  auctionId: number | null;
  currentPage: number | null;
  totalPages: number | null;
  errorMessage: string | null;
}

export type RetrieveResult =
  | { status: "complete"; created: false; auctionId: number; lotCount: number }
  | { status: "in-progress"; runId: number };

export const api = {
  listAuctions: () => request<{ auctions: AuctionSummary[] }>("/api/auctions"),

  getAuction: (id: number, filters: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return request<{ auction: AuctionDetail; lots: LotSummary[]; facets: Facets }>(
      `/api/auctions/${id}${qs ? `?${qs}` : ""}`,
    );
  },

  getLot: (id: number) =>
    request<{ lot: LotDetail; images: LotImageDto[]; auction: { id: number; title: string | null; auctionHouse: string | null } | null; detailFetchError: string | null }>(
      `/api/lots/${id}`,
    ),

  retrieve: (url: string) =>
    request<RetrieveResult>("/api/acquisitions", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  getAcquisitionRun: (runId: number) => request<{ run: AcquisitionRunDto }>(`/api/acquisitions/${runId}`),

  refreshAuction: (id: number) => request<{ auctionId: number; lotCount: number }>(`/api/auctions/${id}/refresh`, { method: "POST" }),

  reimportAuction: (id: number) => request<{ auctionId: number; lotCount: number }>(`/api/auctions/${id}/reimport`, { method: "POST" }),

  deleteLots: (auctionId: number, lotIds: number[]) =>
    request<{ deleted: number; remaining: number }>(`/api/auctions/${auctionId}/lots/delete`, {
      method: "POST",
      body: JSON.stringify({ lotIds }),
    }),

  importLocal: (file: File, sourceUrl: string) => {
    const form = new FormData();
    form.set("file", file);
    if (sourceUrl) form.set("sourceUrl", sourceUrl);
    return request<{ auctionId: number; created: boolean; lotCount: number; status: string }>("/api/import/local", {
      method: "POST",
      body: form,
    });
  },

  search: (q: string) => request<{ results: any[] }>(`/api/search?q=${encodeURIComponent(q)}`),

  downloadImage: (lotId: number, imageId: number) =>
    request<{ localPath: string; alreadyDownloaded: boolean }>(`/api/lots/${lotId}/images/${imageId}/download`, {
      method: "POST",
    }),
};
