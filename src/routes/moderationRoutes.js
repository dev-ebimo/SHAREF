import { Hono } from "hono";
import { getModerationQueue, approveResource, rejectResource, getResourcePreviewForAdmin, getPendingCount } from "../controllers/moderationController.js";
import { protect, restrictTo } from "../middleware/protect.js";

const moderationRoutes = new Hono();

moderationRoutes.use("*", protect, restrictTo("admin"));

moderationRoutes.get("/queue", getModerationQueue);
moderationRoutes.get("/pending-count", getPendingCount);
moderationRoutes.get("/:id/preview", getResourcePreviewForAdmin);
moderationRoutes.post("/:id/approve", approveResource);
moderationRoutes.post("/:id/reject", rejectResource);

export default moderationRoutes;
