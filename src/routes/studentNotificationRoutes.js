import { Hono } from "hono";
import {
  getMyNotifications,
  toggleMyNotificationRead,
  markAllMyNotificationsRead,
} from "../controllers/studentNotificationController.js";
import { protect } from "../middleware/protect.js";

const studentNotificationRoutes = new Hono();

studentNotificationRoutes.use("*", protect);

studentNotificationRoutes.get("/mine", getMyNotifications);
studentNotificationRoutes.patch("/mine/mark-all-read", markAllMyNotificationsRead);
studentNotificationRoutes.patch("/mine/:id/toggle-read", toggleMyNotificationRead);

export default studentNotificationRoutes;
