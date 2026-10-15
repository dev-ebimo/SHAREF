// Runs every test file, one process each, and prints one line per file plus a total.
// Usage: npm test            (all files)        npm test -- consistency   (only files whose name contains "consistency")
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const filter = process.argv[2] || "";
const files = readdirSync(fileURLToPath(new URL(".", import.meta.url))).filter((f) => f.endsWith(".test.js") && f.includes(filter)).sort();
let failedFiles = 0;
let totalChecks = 0;

for (const f of files) {
  const r = spawnSync(process.execPath, ["--experimental-sqlite", "--no-warnings", fileURLToPath(new URL(f, import.meta.url))], { encoding: "utf8", timeout: 300000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = [...out.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
  const passed = m ? Number(m[1]) : 0;
  totalChecks += passed;
  const ok = r.status === 0;
  if (!ok) failedFiles++;
  console.log(`${ok ? "ok  " : "FAIL"} ${f.padEnd(40)} ${m ? `${m[1]} passed, ${m[2]} failed` : "(no summary)"}`);
  if (!ok) console.log(out.split("\n").filter((l) => /FAIL|Error/.test(l)).slice(0, 8).join("\n"));
}
console.log(`\n${files.length - failedFiles}/${files.length} files passing, ${totalChecks} checks passed`);
process.exit(failedFiles ? 1 : 0);
