import { Hono } from "hono";
import { normalizeAcademicData } from "../controllers/adminMaintenanceController.js";
import { protect, restrictTo } from "../middleware/protect.js";

const adminMaintenanceRoutes = new Hono();
adminMaintenanceRoutes.use("*", protect, restrictTo("admin"));
adminMaintenanceRoutes.post("/normalize-academic-data", normalizeAcademicData);
export default adminMaintenanceRoutes;
