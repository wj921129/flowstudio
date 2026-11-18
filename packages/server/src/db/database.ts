import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface DatabaseMigration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export const CURRENT_DB_VERSION = 1;

export const DEFAULT_DATABASE_MIGRATIONS: DatabaseMigration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS diagrams (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          thumbnail TEXT NOT NULL DEFAULT '',
          ydoc_state BLOB,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_diagrams_updated_at ON diagrams(updated_at DESC);

        CREATE TABLE IF NOT EXISTS snapshots (
          id TEXT PRIMARY KEY,
          diagram_id TEXT NOT NULL,
          ydoc_state BLOB NOT NULL,
          label TEXT NOT NULL,
          trigger_type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_snapshots_diagram_id ON snapshots(diagram_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS ai_batches (
          batch_id TEXT PRIMARY KEY,
          diagram_id TEXT NOT NULL,
          agent_name TEXT,
          summary TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          diffs TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          FOREIGN KEY(diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_ai_batches_diagram_id ON ai_batches(diagram_id, created_at DESC);
      `);
    },
  },
];

export function runDatabaseMigrations(
  db: Database.Database,
  migrations: DatabaseMigration[] = DEFAULT_DATABASE_MIGRATIONS,
): void {
  const currentVersion = (db.pragma('user_version', { simple: true }) as number) || 0;
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  for (const migration of sorted) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        migration.up(db);
      })();
      db.pragma(`user_version = ${migration.version}`);
    }
  }
}

export function initDatabase(dbPath: string = 'data/flowstudio.sqlite'): Database.Database {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  runDatabaseMigrations(db);

  return db;
}
