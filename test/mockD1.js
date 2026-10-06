// TEST-ONLY. Implements the subset of Cloudflare D1's binding API our code
// uses (prepare/bind/first/all/run), backed by Node's built-in node:sqlite,
// so route logic can be verified with real SQL against a real SQLite engine
// without needing `wrangler dev`, a Cloudflare account, or network access.
import { DatabaseSync } from "node:sqlite";

export function createMockD1(schemaSql) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schemaSql);

  return {
    prepare(sql) {
      return {
        _sql: sql,
        _args: [],
        bind(...args) {
          this._args = args;
          return this;
        },
        async first() {
          const stmt = raw.prepare(this._sql);
          return stmt.get(...this._args) ?? null;
        },
        async all() {
          const stmt = raw.prepare(this._sql);
          return { results: stmt.all(...this._args) };
        },
        async run() {
          const stmt = raw.prepare(this._sql);
          const info = stmt.run(...this._args);
          return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        },
      };
    },
    // Real D1's batch() executes every statement as one SQL transaction —
    // all succeed or all roll back. Mirrored here with explicit
    // BEGIN/COMMIT/ROLLBACK so a failure partway through a cascade (e.g.
    // permanentlyDeleteResource's multi-table cleanup) is tested against
    // the same guarantee production actually has, not just the happy path.
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const stmt of statements) {
          const prepared = raw.prepare(stmt._sql);
          if (/^\s*SELECT/i.test(stmt._sql)) {
            // Real D1 returns the rows of a SELECT inside batch() as `results`.
            results.push({ success: true, results: prepared.all(...stmt._args), meta: { changes: 0 } });
            continue;
          }
          const info = prepared.run(...stmt._args);
          results.push({ success: true, results: [], meta: { changes: info.changes, last_row_id: info.lastInsertRowid } });
        }
        raw.exec("COMMIT");
        return results;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
    _raw: raw, // escape hatch for test setup (seeding rows directly)
  };
}
