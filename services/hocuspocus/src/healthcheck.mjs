import net from 'node:net';
import pg from 'pg';
import { assertCollabDocumentsSchema } from './persistence.mjs';

const databaseUrl = process.env.DATABASE_URL;
const port = Number.parseInt(process.env.HOCUSPOCUS_PORT || '1234', 10);

if (!databaseUrl || !Number.isInteger(port) || port <= 0) {
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });

  try {
    await assertCollabDocumentsSchema(pool);
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(2_000);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('collaboration port timed out'));
      });
      socket.once('error', reject);
    });
  } catch {
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
