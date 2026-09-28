import { Hono } from "hono";
import {
  getFilterOptions, getApprovedResources, getRejectedResources,
  getResourceDetails, removeApprovedResource, restoreToPending, permanentlyDeleteResource,
} from "../controllers/adminResourceController.js";
import { protect, restrictTo } from "../middleware/protect.js";

const adminResourceRoutes = new Hono();

adminResourceRoutes.use("*", protect, restrictTo("admin"));

adminResourceRoutes.get("/filter-options", getFilterOptions);
adminResourceRoutes.get("/approved", getApprovedResources);
adminResourceRoutes.get("/rejected", getRejectedResources);
adminResourceRoutes.get("/:id", getResourceDetails);
adminResourceRoutes.post("/:id/remove", removeApprovedResource);
adminResourceRoutes.post("/:id/restore", restoreToPending);
adminResourceRoutes.delete("/:id", permanentlyDeleteResource);

export default adminResourceRoutes;
