import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { openDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { attachWebSocket } from './realtime/ws.js';
import { sweepCommands } from './services/commands.js';
import { recoverSessionsOnBoot } from './services/screen.js';
import { state } from './state.js';

state.db = await openDb();
await migrate(state.db);
await recoverSessionsOnBoot();

setInterval(() => void sweepCommands().catch((e) => console.error('[commands]', e)), 60_000).unref();

const server = http.createServer(createApp());
attachWebSocket(server);
server.listen(config.port, () => {
  console.log(`[api] listening on :${config.port}`);
  console.log(`[api] public API URL ${config.publicApiUrl} | enrollment pages ${config.publicWebUrl}`);
  console.log(`[api] database: ${config.databaseUrl ? 'postgres' : `pglite (${config.pgliteDir})`}`);
});

const shutdown = async () => {
  server.close();
  await state.db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
