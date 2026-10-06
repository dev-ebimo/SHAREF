import { normalizeEmail } from "../src/utils/normalizeEmail.js";

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) { console.log("OK  -", label); passed++; }
  else { console.log("FAIL-", label, extra); failed++; }
}

// The exact real-world case this fix exists for.
check("Gmail: dot in local part is stripped", normalizeEmail("ebimotimi.dev@gmail.com") === "ebimotimidev@gmail.com");
check("Gmail: multiple dots all stripped", normalizeEmail("a.b.c.d@gmail.com") === "abcd@gmail.com");
check("Gmail: plus-tag (subaddressing) stripped", normalizeEmail("ada.lovelace+school@gmail.com") === "adalovelace@gmail.com");
check("Gmail: googlemail.com normalized to gmail.com", normalizeEmail("ada.lovelace@googlemail.com") === "adalovelace@gmail.com");
check("Gmail: already-normalized address unchanged", normalizeEmail("adalovelace@gmail.com") === "adalovelace@gmail.com");
check("Gmail: uppercase input lowercased", normalizeEmail("Ada.Lovelace@GMAIL.COM") === "adalovelace@gmail.com");
check("Gmail: dot immediately before +tag handled correctly", normalizeEmail("a.b+tag@gmail.com") === "ab@gmail.com");

// Non-Gmail: lowercase only, dots/plus preserved (no evidence yet that
// other providers need special handling — see normalizeEmail.js's comment).
check("Non-Gmail: dots preserved", normalizeEmail("ada.lovelace@university.edu.ng") === "ada.lovelace@university.edu.ng");
check("Non-Gmail: plus-tag preserved", normalizeEmail("ada+school@yahoo.com") === "ada+school@yahoo.com");
check("Non-Gmail: still lowercased", normalizeEmail("Ada.Lovelace@University.EDU.NG") === "ada.lovelace@university.edu.ng");

// Edge cases
check("Trims surrounding whitespace", normalizeEmail("  ada@gmail.com  ") === "ada@gmail.com");
check("Malformed input (no @) doesn't crash, just lowercases", normalizeEmail("notanemail") === "notanemail");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
