import { Hono } from "hono";
import { createAnnouncement, getAnnouncements } from "../controllers/announcementController.js";
import { protect, restrictTo } from "../middleware/protect.js";

const announcementRoutes = new Hono();

announcementRoutes.use("*", protect, restrictTo("admin"));

announcementRoutes.post("/", createAnnouncement);
announcementRoutes.get("/", getAnnouncements);

export default announcementRoutes;
