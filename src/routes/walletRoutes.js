import { Hono } from "hono";
import { getBalance, initializeFunding, verifyFunding, paystackWebhook, chargeForDownload } from "../controllers/walletController.js";
import { protect } from "../middleware/protect.js";

const walletRoutes = new Hono();

// No `protect` here — this is called by Paystack's own servers, not a
// logged-in user, and is authenticated by its HMAC signature instead (see
// verifyPaystackSignature in the controller).
walletRoutes.post("/webhook", paystackWebhook);

walletRoutes.get("/balance", protect, getBalance);
walletRoutes.post("/fund/initialize", protect, initializeFunding);
walletRoutes.get("/fund/verify/:reference", protect, verifyFunding);
walletRoutes.post("/charge", protect, chargeForDownload);

export default walletRoutes;
