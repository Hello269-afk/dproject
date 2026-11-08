import type { Db } from './db/index.js';

// The process-wide database handle, set once at boot (or per test server).
export const state: { db: Db } = { db: undefined as unknown as Db };
export const db = () => state.db;
