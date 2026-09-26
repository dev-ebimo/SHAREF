const path = require("path");
const express = require("express");
const app = express();
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

app.set("trust proxy", 1);

app.use(cors({
  origin: true,
  credentials: true,
}));

// Health checks for Render / Cloud load balancers
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
}));

// Serve static frontend files with automatic .html extension resolution
app.use(express.static(path.join(__dirname, "Frontend"), { extensions: ["html"] }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: "Too many attempts, please try again later." },
});
app.use("/api/auth", authLimiter);

const walletLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Too many requests, please slow down." },
});
app.use("/api/wallet", walletLimiter);

const { paystackWebhook } = require("./controllers/walletController");
// Must come BEFORE express.json() — Paystack's signature check needs the raw body
app.post("/api/wallet/webhook", express.raw({ type: "application/json" }), paystackWebhook);

app.use(express.json());

const walletRoutes = require("./routes/walletRoutes");
app.use("/api/wallet", walletRoutes);

const adminRoutes = require("./routes/adminRoutes");
app.use("/api/admin", adminRoutes);

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

// Database offline graceful fallback
app.use((err, req, res, next) => {
  if (
    err.name === "MongooseError" ||
    err.name === "MongoNetworkError" ||
    (err.message && err.message.includes("buffering timed out"))
  ) {
    console.warn("[AI Studio] Database offline — returning mock empty response");
    if (req.method === "GET") {
      return res.json(req.path.endsWith("s") || req.path.endsWith("s/") ? [] : {});
    }
    return res.status(503).json({ error: "Service temporarily unavailable (database offline)" });
  }
  next(err);
});

// SPA fallback for non-API client routes
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api")) {
    return res.sendFile(path.join(__dirname, "Frontend", "index.html"));
  }
  next();
});

const errorHandler = require("./middleware/errorHandler");
app.use(errorHandler); // must be last

module.exports = app;

