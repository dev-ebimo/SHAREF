// Single source of truth for the backend's base URL. Change this one line
// when moving between local dev and production, instead of hunting through
// every page's fetch() calls individually.
//
// TODO: replace with your actual deployed Workers URL. Cloudflare gives
// every Worker a free URL of the form:
//   https://<worker-name>.<your-workers-subdomain>.workers.dev
// The worker name here is "sharef-api" (set in wrangler.toml). Your
// workers.dev subdomain is shown in the Cloudflare dashboard (Workers &
// Pages → your account) or printed after your first `wrangler deploy`. If
// you later attach a custom domain/route to the Worker, use that instead.
const API_BASE = "https://sharef-api.sharef-backend.workers.dev/api";
