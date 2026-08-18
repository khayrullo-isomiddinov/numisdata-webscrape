import { getDb } from "../../database/schema.ts";
import { AcquisitionRunRepository } from "../../database/repositories/acquisition-run-repository.ts";
import { retrieveAuction } from "../services/ingestion-service.ts";
import { json, errorResponse } from "./http-helpers.ts";

export async function handleCreateAcquisition(req: Request): Promise<Response> {
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body with a url field." }, 400);
  }

  if (typeof body.url !== "string" || body.url.trim().length === 0) {
    return json({ error: "Please provide a valid Biddr auction URL." }, 400);
  }

  try {
    const result = await retrieveAuction(body.url.trim());
    return json({
      auctionId: result.auction.id,
      created: result.created,
      lotCount: result.lotCount,
      status: "complete",
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleGetAcquisition(req: Request & { params: { id: string } }): Promise<Response> {
  const run = new AcquisitionRunRepository(getDb()).findById(Number(req.params.id));
  if (!run) return json({ error: "Acquisition run not found." }, 404);
  return json({ run });
}
