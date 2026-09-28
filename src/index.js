import { Hono } from "hono";
import { cors } from "hono/cors";
import authRoutes from "./routes/authRoutes.js";
import bookmarkRoutes from "./routes/bookmarkRoutes.js";
import studentNotificationRoutes from "./routes/studentNotificationRoutes.js";
import resourceRoutes from "./routes/resourceRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import moderationRoutes from "./routes/moderationRoutes.js";
import adminResourceRoutes from "./routes/adminResourceRoutes.js";
import announcementRoutes from "./routes/announcementRoutes.js";
import adminNotificationRoutes from "./routes/adminNotificationRoutes.js";
import adminUserRoutes from "./routes/adminUserRoutes.js";
import adminTransactionRoutes from "./routes/adminTransactionRoutes.js";
import userSettingsRoutes from "./routes/userSettingsRoutes.js";

const app = new Hono();

// --- CORS -------------------------------------------------------------
// Equivalent to app.js's cors({ origin: allowedOrigins, credentials: true }).
// env.FRONTEND_URL comes from wrangler.toml's [vars] (or a secret, in prod).
app.use("*", async (c, next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      const allowed = [
        "http://localhost:5000",
        c.env.FRONTEND_URL,
      ];
      return !origin || allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    maxAge: 86400, // same fix as the Render app.js CORS patch
  });
  return corsMiddleware(c, next);
});

// --- Health check -------------------------------------------------------
// Proves the D1 binding actually works end to end, not just that the app
// boots. Hits the real `users` table via env.DB, the same binding every
// future route will use.
app.get("/api/health", async (c) => {
  const result = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
  return c.json({
    success: true,
    message: "Sharef API (Workers) is up",
    usersInDb: result.count,
  });
});

// --- Route groups --------------------------------------------------------
app.route("/api/auth", authRoutes);
app.route("/api/bookmarks", bookmarkRoutes);
app.route("/api/notifications", studentNotificationRoutes);
app.route("/api/resources", resourceRoutes);
app.route("/api/wallet", walletRoutes);
app.route("/api/admin/moderation", moderationRoutes);
app.route("/api/admin/resources", adminResourceRoutes);
app.route("/api/admin/announcements", announcementRoutes);
app.route("/api/admin/notifications", adminNotificationRoutes);
app.route("/api/admin/users", adminUserRoutes);
app.route("/api/admin", adminTransactionRoutes);
app.route("/api/users", userSettingsRoutes);

app.notFound((c) => c.json({ success: false, message: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, message: "Internal server error" }, 500);
});

export default app;
