import { Hono } from "hono";
import { cors } from "hono/cors";
import { purgeStaleUploads } from "./jobs/purgeStaleUploads.js";
import authRoutes from "./routes/authRoutes.js";
import bookmarkRoutes from "./routes/bookmarkRoutes.js";
import studentNotificationRoutes from "./routes/studentNotificationRoutes.js";
import resourceRoutes from "./routes/resourceRoutes.js";
import downloadsRoutes from "./routes/downloadsRoutes.js";
import incentiveRoutes from "./routes/incentiveRoutes.js";
import adminIncentiveRoutes from "./routes/adminIncentiveRoutes.js";
import { runScheduledJobs } from "./jobs/incentiveJobs.js";
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
      // localhost is only allowed when running `wrangler dev` (NODE_ENV=development
      // in .dev.vars) — never in production, where it would let any program
      // on a visitor's own machine call the API with their credentials.
      const allowed = [c.env.FRONTEND_URL];
      if (c.env.NODE_ENV === "development") allowed.push("http://localhost:5000");
      return !origin || allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    maxAge: 86400, // same fix as the Render app.js CORS patch
  });
  return corsMiddleware(c, next);
});

// --- Security headers ---------------------------------------------------
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "no-referrer");
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
});

// --- Health check -------------------------------------------------------
// Proves the D1 binding actually works end to end, not just that the app
// boots. Hits the real `users` table via env.DB, the same binding every
// future route will use.
app.get("/api/health", async (c) => {
  // Still proves the D1 binding works, but no longer publishes the user count.
  await c.env.DB.prepare("SELECT 1 AS ok").first();
  return c.json({ success: true, message: "Sharef API (Workers) is up" });
});

// --- Route groups --------------------------------------------------------
app.route("/api/auth", authRoutes);
app.route("/api/bookmarks", bookmarkRoutes);
app.route("/api/notifications", studentNotificationRoutes);
app.route("/api/resources", resourceRoutes);
app.route("/api/downloads", downloadsRoutes);
app.route("/api/incentives", incentiveRoutes);
app.route("/api/wallet", walletRoutes);
app.route("/api/admin/moderation", moderationRoutes);
app.route("/api/admin/resources", adminResourceRoutes);
app.route("/api/admin/announcements", announcementRoutes);
app.route("/api/admin/notifications", adminNotificationRoutes);
app.route("/api/admin/users", adminUserRoutes);
app.route("/api/admin/incentives", adminIncentiveRoutes);
app.route("/api/admin", adminTransactionRoutes);
app.route("/api/users", userSettingsRoutes);

app.notFound((c) => c.json({ success: false, message: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, message: "Internal server error" }, 500);
});

// Cron Trigger entry point; the schedule logic lives in jobs/incentiveJobs.js (see wrangler.toml for the crons).
async function scheduled(event, env, ctx) {
  runScheduledJobs(event, env, ctx, { purgeStaleUploads });
}

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled,
};
