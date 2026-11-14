import { MongoClient, type Db } from 'mongodb';

/**
 * Single shared MongoDB connection for the whole server process.
 *
 * - Long-running server (`npm start`): one client, one pool.
 * - Vercel / serverless: the client is cached on `globalThis` so warm invocations reuse it.
 *
 * Environment:
 *   MONGODB_URI        required, e.g. mongodb+srv://user:pass@cluster.mongodb.net
 *   MONGODB_DB_NAME    optional, defaults to "umrah360"
 *   MONGODB_MAX_POOL   optional, defaults to 10
 */
const g = globalThis as any;

export function isMongoConfigured(): boolean {
  return Boolean((process.env.MONGODB_URI || '').trim());
}

export function mongoDbName(): string {
  return (process.env.MONGODB_DB_NAME || 'umrah360').trim();
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!g.__umrahMongoClient) {
    const uri = (process.env.MONGODB_URI || '').trim();
    if (!uri) {
      throw new Error('MONGODB_URI is not set. Add your MongoDB connection string to the environment.');
    }
    const client = new MongoClient(uri, {
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL) || 10,
      ignoreUndefined: true,
      serverSelectionTimeoutMS: 10_000,
      retryWrites: true,
    });
    g.__umrahMongoClient = client.connect().catch((err) => {
      g.__umrahMongoClient = undefined;
      throw err;
    });
  }
  return g.__umrahMongoClient as Promise<MongoClient>;
}

export async function getMongoDb(): Promise<Db> {
  return (await getMongoClient()).db(mongoDbName());
}

export async function closeMongo(): Promise<void> {
  if (!g.__umrahMongoClient) return;
  const client = await g.__umrahMongoClient;
  g.__umrahMongoClient = undefined;
  await client.close();
}
