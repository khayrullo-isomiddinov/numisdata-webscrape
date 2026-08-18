import { importLocalAuctionPage } from "../services/ingestion-service.ts";
import { json, errorResponse } from "./http-helpers.ts";

/**
 * Accepts a browser-uploaded "Save Page As..." file via multipart form data. We only ever read
 * the bytes the browser sends in the request body - there is no server-side file path involved,
 * so there is nothing here for path traversal to exploit.
 */
export async function handleLocalImport(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected a multipart/form-data upload with an html file." }, 400);
  }

  const file = form.get("file");
  const declaredUrl = form.get("sourceUrl");
  if (!(file instanceof File)) {
    return json({ error: "Please attach a saved HTML file." }, 400);
  }

  const content = await file.text();
  try {
    const result = await importLocalAuctionPage(content, typeof declaredUrl === "string" && declaredUrl.trim() ? declaredUrl.trim() : null);
    return json({ auctionId: result.auction.id, created: result.created, lotCount: result.lotCount, status: "complete" });
  } catch (err) {
    return errorResponse(err);
  }
}
