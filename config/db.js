const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    mongoose.set("bufferCommands", false); // CRITICAL: fail fast, don't hang
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sharef";
    const conn = await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.warn(`MongoDB not connected — running with offline fallback: ${err.message}`);
  }
};

module.exports = connectDB;