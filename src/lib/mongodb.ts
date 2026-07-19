import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalWithMongoose = global as typeof globalThis & { mongooseCache?: Cache };
const cache = globalWithMongoose.mongooseCache ?? { conn: null, promise: null };
globalWithMongoose.mongooseCache = cache;

export async function connectMongo() {
  if (!uri) throw new Error("MONGODB_URI is not configured");
  if (cache.conn) return cache.conn;
  cache.promise ??= mongoose.connect(uri, { bufferCommands: false, maxPoolSize: 10, minPoolSize: 0, serverSelectionTimeoutMS: 10000 });
  cache.conn = await cache.promise;
  return cache.conn;
}
