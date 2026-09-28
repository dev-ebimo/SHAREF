// Turns a plain JS value into its literal SQL representation. Used to
// build a static .sql file (not a parameterized query), so proper
// escaping here is what stands between a title containing an apostrophe
// and a broken migration — or worse, a syntactically-valid but wrong
// statement.
export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot write non-finite number to SQL: ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  // Standard SQL string escaping: a literal single quote inside the value
  // is represented as two single quotes, not a backslash escape.
  return `'${String(value).replace(/'/g, "''")}'`;
}

// One INSERT OR REPLACE per row rather than a single multi-row INSERT —
// verbose, but means a migration re-run after a partial failure is safe
// (every row keyed by its original Mongo _id, so re-inserting an
// already-migrated row overwrites it with identical data rather than
// erroring on a duplicate primary key) and any single bad row's exact
// content is visible directly in the file rather than hidden inside a
// giant multi-row VALUES list.
export function buildInsertStatement(table, row) {
  const columns = Object.keys(row);
  const values = columns.map((col) => sqlLiteral(row[col]));
  return `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});`;
}

export function buildInsertStatements(table, rows) {
  return rows.map((row) => buildInsertStatement(table, row));
}
