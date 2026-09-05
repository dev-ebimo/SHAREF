const crypto = require("crypto");

// Generates a 6-digit numeric OTP as a string, e.g. "042917"
// Uses crypto.randomInt (CSPRNG) rather than Math.random(), since this code
// gates email verification / password reset and shouldn't be guessable or
// predictable from observing other outputs.
function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

module.exports = generateOTP;