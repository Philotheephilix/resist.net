// Writes probe results to Arkiv. Falls back to local SQLite cache when offline.
// On reconnect, drains the cache in batch.

import Database from "better-sqlite3";
import path from "path";
import { ProbeResult } from "@resist/shared/src/types";

const DB_PATH = path.join(process.env.HOME || "~", ".resist-net", "offline-cache.db");

function getDb() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS pending (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  return db;
}

async function writeToArkiv(_result: ProbeResult): Promise<boolean> {
  // TODO: replace with real Arkiv SDK call
  // await arkiv.entity("ProbeResult").create({ ...result, ttl: 30 * 24 * 3600 })
  return true;
}

export async function syncToArkiv(results: ProbeResult[]) {
  const db = getDb();

  // First drain any cached results
  const pending = db.prepare("SELECT * FROM pending ORDER BY created_at ASC").all() as { id: string; payload: string }[];
  for (const row of pending) {
    const result = JSON.parse(row.payload) as ProbeResult;
    const ok = await writeToArkiv(result);
    if (ok) db.prepare("DELETE FROM pending WHERE id = ?").run(row.id);
  }

  // Write new results
  for (const result of results) {
    const ok = await writeToArkiv(result);
    if (!ok) {
      db.prepare("INSERT OR IGNORE INTO pending (id, payload, created_at) VALUES (?, ?, ?)").run(
        result.id, JSON.stringify(result), result.timestamp
      );
    }
  }
}
