import { Hono } from "hono";
import { getUserFilterOptions, getUsers, getUserProfile, suspendUser, reactivateUser, getDeletedAccountLogs } from "../controllers/adminUserController.js";
import { protect, restrictTo } from "../middleware/protect.js";

const adminUserRoutes = new Hono();

adminUserRoutes.use("*", protect, restrictTo("admin"));

adminUserRoutes.get("/filter-options", getUserFilterOptions);
adminUserRoutes.get("/deleted-log", getDeletedAccountLogs);
adminUserRoutes.get("/", getUsers);
adminUserRoutes.get("/:id", getUserProfile);
adminUserRoutes.post("/:id/suspend", suspendUser);
adminUserRoutes.post("/:id/reactivate", reactivateUser);

export default adminUserRoutes;
