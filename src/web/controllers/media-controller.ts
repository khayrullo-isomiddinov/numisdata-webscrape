import { join, normalize, sep } from "node:path";

const DATA_ROOT = join(process.cwd(), "data");
const ALLOWED_PREFIXES = [`images${sep}`];

/**
 * Serves locally-downloaded images (Mode 2 of the image handling design) back to the browser
 * from data/images/. The requested path is normalized and re-checked against the data directory
 * root before touching the filesystem, so a crafted "../../" segment can't escape it; only the
 * images/ subtree is served (never data/sources/ or the sqlite file itself).
 */
export async function handleServeMedia(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const relative = decodeURIComponent(url.pathname.replace(/^\/media\//, ""));
  const normalized = normalize(relative);

  if (normalized.startsWith("..") || normalized.startsWith("/") || normalized.includes("\0")) {
    return new Response("Not found", { status: 404 });
  }
  if (!ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = join(DATA_ROOT, normalized);
  if (!filePath.startsWith(DATA_ROOT + sep)) {
    return new Response("Not found", { status: 404 });
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file);
}
