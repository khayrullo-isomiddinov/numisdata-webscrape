import { handleCreateAcquisition, handleGetAcquisition } from "../controllers/acquisitions-controller.ts";
import {
  handleDeleteLots,
  handleGetAuction,
  handleListAuctions,
  handleReimportAuction,
  handleRefreshAuction,
} from "../controllers/auctions-controller.ts";
import { handleDownloadLotImage, handleGetLot } from "../controllers/lots-controller.ts";
import { handleSearch } from "../controllers/search-controller.ts";
import { handleLocalImport } from "../controllers/import-controller.ts";
import { handleServeMedia } from "../controllers/media-controller.ts";

/**
 * Route table consumed by Bun.serve({ routes }). Kept as plain data (path -> method -> handler)
 * so index.ts can spread it alongside the HTML import routes without any framework glue.
 */
export const apiRoutes = {
  "/api/acquisitions": {
    POST: handleCreateAcquisition,
  },
  "/api/acquisitions/:id": {
    GET: handleGetAcquisition,
  },
  "/api/auctions": {
    GET: handleListAuctions,
  },
  "/api/auctions/:id": {
    GET: handleGetAuction,
  },
  "/api/auctions/:id/refresh": {
    POST: handleRefreshAuction,
  },
  "/api/auctions/:id/reimport": {
    POST: handleReimportAuction,
  },
  "/api/auctions/:id/lots/delete": {
    POST: handleDeleteLots,
  },
  "/api/lots/:id": {
    GET: handleGetLot,
  },
  "/api/lots/:id/images/:imageId/download": {
    POST: handleDownloadLotImage,
  },
  "/api/search": {
    GET: handleSearch,
  },
  "/api/import/local": {
    POST: handleLocalImport,
  },
  "/media/*": {
    GET: handleServeMedia,
  },
} as const;
