import { Hono } from "hono";
import { listMyDownloads, getDownloadFile } from "../controllers/downloadsController.js";
import { protect } from "../middleware/protect.js";

const downloadsRoutes = new Hono();

// A student's library of files they have paid for. Re-downloading is free.
downloadsRoutes.get("/", protect, listMyDownloads);
downloadsRoutes.get("/:resourceId/file", protect, getDownloadFile);

export default downloadsRoutes;
