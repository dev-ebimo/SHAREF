// Some ISPs/Windows DNS resolvers fail on MongoDB Atlas's SRV lookup —
// forcing Google/Cloudflare DNS here fixes that. Safe to remove if you
// ever migrate off Atlas or confirm your network resolves SRV records fine.
const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require("dotenv").config();
const connectDB = require("./config/db");
const app = require("./app");

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err.message);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message);
});

connectDB();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));