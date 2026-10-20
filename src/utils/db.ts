import mongoose from "mongoose";
import { logger } from "./logger";

const MONGODB_URI = process.env.MONGODB_URI;

type CachedConnection = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mongooseCache: CachedConnection | undefined;
}

const cache: CachedConnection = global.__mongooseCache || {
  conn: null,
  promise: null,
};
global.__mongooseCache = cache;

/**
 * Connect to MongoDB with a cached connection suitable for Vercel serverless.
 * Safe to call on every request — reuses the open connection across warm invocations.
 */
export const connectDB = async (): Promise<typeof mongoose> => {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not defined in environment variables");
  }

  if (cache.conn && mongoose.connection.readyState === 1) {
    return cache.conn;
  }

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        // Fail fast instead of hanging ~10s then throwing buffer timeout
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
        maxPoolSize: 5,
      })
      .then((conn) => {
        logger.info(
          `Connected to MongoDB: ${conn.connection.host}/${conn.connection.name}`
        );
        return conn;
      })
      .catch((error) => {
        cache.promise = null;
        logger.error("MongoDB connection error:", error);
        throw error;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
};

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
