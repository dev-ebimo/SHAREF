const express = require("express");
const app = express();
const cors = require("cors");

const allowedOrigins = [
  "http://localhost:5000", // adjust to whatever port your frontend runs on locally
  process.env.FRONTEND_URL, // your real Vercel URL, set in Render's env vars
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

app.use(helmet());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: "Too many attempts, please try again later." },
});
app.use("/api/auth", authLimiter);

const { paystackWebhook } = require("./controllers/walletController");
// Registered BEFORE walletLimiter below so Paystack's server-to-server
// webhook calls are exempt from the per-user wallet rate limit — otherwise
// webhook delivery could get throttled alongside regular user traffic,
// and this endpoint is the real source of truth for crediting wallets.
// Must also come BEFORE express.json() — Paystack's signature check needs the raw body.
app.post("/api/wallet/webhook", express.raw({ type: "application/json" }), paystackWebhook);

const walletLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down." },
});
app.use("/api/wallet", walletLimiter);

app.use(express.json());

const walletRoutes = require("./routes/walletRoutes");
app.use("/api/wallet", walletRoutes);

app.set("trust proxy", 1);

const adminRoutes = require("./routes/adminRoutes");
app.use("/api/admin/transactions", adminRoutes);

const authRoutes = require("./routes/authRoutes");
app.use("/api/auth", authRoutes);

const resourceRoutes = require("./routes/resourceRoutes");
app.use("/api/resources", resourceRoutes);

const moderationRoutes = require("./routes/moderationRoutes");
app.use("/api/admin/moderation", moderationRoutes);

const adminResourceRoutes = require("./routes/adminResourceRoutes");
app.use("/api/admin/resources", adminResourceRoutes);

const adminUserRoutes = require("./routes/adminUserRoutes");
app.use("/api/admin/users", adminUserRoutes);

const notificationRoutes = require("./routes/notificationRoutes");
app.use("/api/admin/notifications", notificationRoutes);

const bookmarkRoutes = require("./routes/bookmarkRoutes");
app.use("/api/bookmarks", bookmarkRoutes);

const userSettingsRoutes = require("./routes/userSettingsRoutes");
app.use("/api/users", userSettingsRoutes);

const studentNotificationRoutes = require("./routes/studentNotificationRoutes");
app.use("/api/notifications", studentNotificationRoutes);

const announcementRoutes = require("./routes/announcementRoutes");
app.use("/api/admin/announcements", announcementRoutes);

const errorHandler = require("./middleware/errorHandler");
app.use(errorHandler); // must be last

module.exports = app;

