# Save point 2 — Security

Overlay zip: unzip over your repo root (same relative paths). Includes everything from save point 1's
files only if they changed again; if you skipped save point 1, apply it first.

## Deploy order
1. `npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/002_security_hardening.sql`
   (adds 5 columns; clears any in-flight plaintext OTPs — affected users just tap "Resend code")
2. `npm run deploy`   (Worker)
3. Deploy the Frontend folder to Vercel (settings.js / admin-settings.js changed: they store the
   refreshed token after a password change).

Run the migration BEFORE the code: the new code selects these columns.

## Optional config (wrangler.toml [vars])
- `PBKDF2_ITERATIONS` — default 10000 (fits the free plan's 10 ms CPU). Max 100000 (Workers cap).
  Raise it if you move to the paid plan; each user's hash upgrades automatically on their next login.
- Make sure `NODE_ENV = "development"` exists ONLY in `.dev.vars`, never in production vars
  (it enables localhost CORS and verbose error details).

## What changed
See the chat summary. Key files: utils/password.js, utils/otp.js, middleware/protect.js,
controllers/authController.js, controllers/userSettingsController.js, controllers/adminUserController.js,
services/emailService.js, utils/pageCounter.js, middleware/rateLimiter.js, index.js, every controller (error leakage).
