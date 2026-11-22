import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { openDatabase } from '../server/database.js';

export async function createIsolatedDatabase() {
  const postgres = new PGlite();
  const socket = new PGLiteSocketServer({ db: postgres, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await socket.start();
  const database = await openDatabase(`postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable`);
  return {
    database: {
      ...database,
      async close() {
        await database.close();
        await socket.stop();
        await postgres.close();
      },
    },
    postgres,
  };
}
