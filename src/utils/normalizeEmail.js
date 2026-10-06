// Matches express-validator's `.normalizeEmail()` (the original app calls
// this, with default options, on every email field — register, login,
// verify-otp, forgot-password, reset-password, profile update). Existing
// users' emails in D1 were already normalized this way at the moment they
// registered on the original app, so login/lookup input has to be
// normalized identically or it simply won't match the stored row — this
// is not cosmetic, it's query correctness against already-migrated data.
//
// Only the Gmail-specific rule is implemented, confirmed precisely against
// validator.js's actual documented behavior: lowercase, strip all dots
// from the local part, truncate at the first "+" (subaddressing), and
// normalize googlemail.com -> gmail.com. Other providers validator.js also
// special-cases (Yahoo, Outlook/Hotmail/Live, iCloud) are NOT replicated
// here — their exact subaddress-separator rules were inconsistent across
// sources while researching this fix, and a wrong guess risks silently
// mismatching a different provider's addresses the same way the naive
// lowercase-only version just did for Gmail. If a similar login/lookup
// failure ever surfaces for a Yahoo/Outlook/iCloud address with a "+" in
// it, this is almost certainly why — extend this function the same way,
// but verify the exact rule first rather than guessing.
export function normalizeEmail(email) {
  const lower = email.trim().toLowerCase();
  const atIndex = lower.lastIndexOf("@");
  if (atIndex === -1) return lower; // not a well-formed email; let email validation catch it elsewhere

  let local = lower.slice(0, atIndex);
  let domain = lower.slice(atIndex + 1);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "").split("+")[0];
    domain = "gmail.com";
  }

  return `${local}@${domain}`;
}
