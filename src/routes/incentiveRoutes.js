import { Hono } from "hono";
import { getIncentiveStatus, getMyIncentives, getOpenRequests, getLeaderboard } from "../controllers/incentiveController.js";
import { protect } from "../middleware/protect.js";

const incentiveRoutes = new Hono();

// Student-facing. While the program is off/shadow these answer "not open yet"
// (config always answers, so the UI can decide whether to show anything).
incentiveRoutes.get("/config", protect, getIncentiveStatus);
incentiveRoutes.get("/me", protect, getMyIncentives);
incentiveRoutes.get("/requests", protect, getOpenRequests);
incentiveRoutes.get("/leaderboard", protect, getLeaderboard);

export default incentiveRoutes;
