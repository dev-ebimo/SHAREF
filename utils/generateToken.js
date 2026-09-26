const jwt = require("jsonwebtoken");

// Signs a token containing the user's id and role.
// Payload stays minimal — anything else needed gets fetched from the DB via the id.
function generateToken(userId, role) {
  return jwt.sign({ id: userId, role }, process.env.JWT_SECRET || "sharef-dev-fallback-jwt-secret-key-2026", {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
}

module.exports = generateToken;