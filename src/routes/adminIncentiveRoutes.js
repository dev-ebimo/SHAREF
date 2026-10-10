import { Hono } from "hono";
import {
  getSummary, getFlagCount, setStatus, getConfig, updateConfig, getPayouts, reversePayout,
  getFlags, resolveFlag, listRequests, createRequest, closeRequest, getAudit,
} from "../controllers/adminIncentiveController.js";
import { protect, restrictTo } from "../middleware/protect.js";

const adminIncentiveRoutes = new Hono();

adminIncentiveRoutes.use("*", protect, restrictTo("admin"));

adminIncentiveRoutes.get("/summary", getSummary);
adminIncentiveRoutes.get("/flag-count", getFlagCount);
adminIncentiveRoutes.post("/status", setStatus);
adminIncentiveRoutes.get("/config", getConfig);
adminIncentiveRoutes.put("/config", updateConfig);
adminIncentiveRoutes.get("/payouts", getPayouts);
adminIncentiveRoutes.post("/payouts/:id/reverse", reversePayout);
adminIncentiveRoutes.get("/flags", getFlags);
adminIncentiveRoutes.post("/flags/:id/resolve", resolveFlag);
adminIncentiveRoutes.get("/requests", listRequests);
adminIncentiveRoutes.post("/requests", createRequest);
adminIncentiveRoutes.post("/requests/:id/close", closeRequest);
adminIncentiveRoutes.get("/audit", getAudit);

export default adminIncentiveRoutes;
