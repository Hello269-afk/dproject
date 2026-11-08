import { openDb } from './index.js';
import { migrate } from './migrate.js';

const db = await openDb();
await migrate(db);
await db.close();
