import { Hono } from "hono";
import { getTransactionSummary, getTransactions } from "../controllers/adminTransactionController.js";
import { protect, restrictTo } from "../middleware/protect.js";

const adminTransactionRoutes = new Hono();

adminTransactionRoutes.use("*", protect, restrictTo("admin"));

adminTransactionRoutes.get("/transactions/summary", getTransactionSummary);
adminTransactionRoutes.get("/transactions", getTransactions);

export default adminTransactionRoutes;
