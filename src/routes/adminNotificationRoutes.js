import { Hono } from "hono";
import { getNotifications, toggleRead, markAllRead, quickApprove, quickReject, quickPreview } from "../controllers/adminNotificationController.js";
import { protect, restrictTo } from "../middleware/protect.js";

const adminNotificationRoutes = new Hono();

adminNotificationRoutes.use("*", protect, restrictTo("admin"));

adminNotificationRoutes.get("/", getNotifications);
adminNotificationRoutes.get("/:id/preview", quickPreview);
adminNotificationRoutes.patch("/mark-all-read", markAllRead);
adminNotificationRoutes.patch("/:id/toggle-read", toggleRead);
adminNotificationRoutes.post("/:id/approve", quickApprove);
adminNotificationRoutes.post("/:id/reject", quickReject);

export default adminNotificationRoutes;
