// New rows get a UUID (crypto.randomUUID is native Web Crypto, no deps).
// Rows migrated from MongoDB keep their original ObjectId string as `id` —
// both are just TEXT primary keys, so old and new ids coexist fine.
export function generateId() {
  return crypto.randomUUID();
}
