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
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Numismatic Archive running at ${server.url}`);
