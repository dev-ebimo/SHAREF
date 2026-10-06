import fs from "node:fs";
import app from "../src/index.js";
import { createMockD1 } from "./mockD1.js";

const schemaSql = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
const DB = createMockD1(schemaSql);

// Seed one real user row so the health check has something to count.
DB._raw.exec(`
  INSERT INTO users (id, full_name, email, password)
  VALUES ('u1', 'Test User', 'test@example.com', 'hashed')
`);

const env = { DB, FRONTEND_URL: "https://sharef-test.vercel.app" };

async function run() {
  // 1. Health check actually queries D1 and gets a real count back
  const res = await app.fetch(new Request("http://localhost/api/health"), env);
  const body = await res.json();
  console.log("GET /api/health ->", res.status, body);
  if (res.status !== 200) throw new Error("FAIL: expected 200");
  if (body.usersInDb !== undefined) throw new Error("FAIL: health endpoint must not expose user count");

  // 2. CORS: allowed origin gets reflected back
  const res2 = await app.fetch(
    new Request("http://localhost/api/health", { headers: { Origin: "https://sharef-test.vercel.app" } }),
    env
  );
  const acao = res2.headers.get("access-control-allow-origin");
  console.log("Access-Control-Allow-Origin (allowed origin) ->", acao);
  if (acao !== "https://sharef-test.vercel.app") throw new Error("FAIL: allowed origin not reflected");

  // 3. CORS: disallowed origin does NOT get reflected
  const res3 = await app.fetch(
    new Request("http://localhost/api/health", { headers: { Origin: "https://evil.example.com" } }),
    env
  );
  const acao3 = res3.headers.get("access-control-allow-origin");
  console.log("Access-Control-Allow-Origin (disallowed origin) ->", acao3);
  if (acao3 === "https://evil.example.com") throw new Error("FAIL: disallowed origin was reflected");

  // 4. Preflight OPTIONS returns the maxAge we set
  const res4 = await app.fetch(
    new Request("http://localhost/api/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://sharef-test.vercel.app",
        "Access-Control-Request-Method": "GET",
      },
    }),
    env
  );
  const maxAge = res4.headers.get("access-control-max-age");
  console.log("Access-Control-Max-Age ->", maxAge);
  if (maxAge !== "86400") throw new Error(`FAIL: expected maxAge=86400, got ${maxAge}`);

  // 5. 404 handler
  const res5 = await app.fetch(new Request("http://localhost/api/nonexistent"), env);
  console.log("GET /api/nonexistent ->", res5.status);
  if (res5.status !== 404) throw new Error("FAIL: expected 404");

  console.log("\nALL SKELETON TESTS PASSED");
}

run().catch((e) => {
  console.error("\nTEST FAILURE:", e.message);
  process.exit(1);
});
