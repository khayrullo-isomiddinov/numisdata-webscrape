import index from "./index.html";
import { apiRoutes } from "./src/web/routes/api.ts";
import { getDb } from "./src/database/schema.ts";

// Ensure the database + migrations are ready before accepting traffic.
getDb();

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  routes: {
    ...apiRoutes,
    "/": index,
    "/auctions/:id": index,
    "/lots/:id": index,
    "/search": index,
    "/guide": index,
  },
  // Bun's default is 10s. Retrieve/Refresh acquire every page of an auction in one request,
  // rate-limited to ~3s/page (see rate-limit.ts) - a sixbid auction with 8 pages alone takes
  // ~21s, and the MAX_PAGES cap (50, see acquisition-manager.ts / sixbid-api.ts) allows up to
  // ~150s worst case. Without raising this, Bun kills the connection mid-acquisition and the
  // client sees an empty response even though the server keeps working and persists the data.
  idleTimeout: 180,
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Numismatic Archive running at ${server.url}`);
