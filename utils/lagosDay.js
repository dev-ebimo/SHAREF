// Nigeria (WAT) is a fixed UTC+1 offset with no daylight saving time, so
// this needs no timezone library — a simple, constant shift is exact and
// stays exact indefinitely.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

// Returns the UTC Date instant corresponding to midnight today in
// Africa/Lagos time. Used for "today" stats (e.g. admin moderation's
// Approved/Rejected Today counts) so the day boundary matches what an
// admin actually sees on their own clock, rather than wherever the
// server's system clock happens to be set — typically UTC on most hosts,
// which would otherwise roll the "day" over at 1am WAT instead of
// midnight.
function startOfTodayInLagos() {
  const shifted = new Date(Date.now() + LAGOS_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - LAGOS_OFFSET_MS);
}

module.exports = { startOfTodayInLagos };
