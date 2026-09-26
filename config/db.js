const mongoose = require("mongoose");
const seedDatabase = require("./seed");

let memoryServerInstance = null;

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (mongoUri) {
    try {
      mongoose.set("bufferCommands", false);
      const conn = await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log(`MongoDB connected: ${conn.connection.host}`);
      await seedDatabase();
      return;
    } catch (err) {
      console.warn(`External MongoDB connection failed (${err.message}). Starting embedded database...`);
    }
  }

  try {
    const { MongoMemoryServer } = require("mongodb-memory-server");
    memoryServerInstance = await MongoMemoryServer.create();
    const uri = memoryServerInstance.getUri();
    mongoose.set("bufferCommands", false);
    await mongoose.connect(uri);
    console.log(`Connected to in-memory MongoDB at ${uri}`);
    await seedDatabase();
  } catch (err) {
    console.error(`Database initialization error: ${err.message}`);
  }
};

module.exports = connectDB;