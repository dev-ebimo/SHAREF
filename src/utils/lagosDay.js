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
export function startOfTodayInLagos() {
  const shifted = new Date(Date.now() + LAGOS_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - LAGOS_OFFSET_MS);
}

// ---- Added for the incentive program ---------------------------------------
// All "this month" / "this week" windows follow the Lagos calendar, for the same
// reason as startOfTodayInLagos above (the server clock is UTC).

// Midnight at the start of the 1st of the current month, Africa/Lagos.
export function startOfMonthInLagos() {
  const shifted = new Date(Date.now() + LAGOS_OFFSET_MS);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - LAGOS_OFFSET_MS);
}

// Midnight at the start of the current week. Weeks start on MONDAY.
export function startOfWeekInLagos() {
  const shifted = new Date(Date.now() + LAGOS_OFFSET_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  shifted.setUTCDate(shifted.getUTCDate() - daysSinceMonday);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - LAGOS_OFFSET_MS);
}

// "YYYY-MM-DD" for today in Lagos.
export function todayInLagosYmd() {
  return new Date(Date.now() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

// ISO instant of 23:59:59.999 on the given Lagos calendar day ("YYYY-MM-DD"),
// or null if the string is not a real date.
export function endOfLagosDayIso(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999) - LAGOS_OFFSET_MS).toISOString();
}
