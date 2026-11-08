import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function initDatabase(dbPath: string = 'data/flowstudio.sqlite'): Database.Database {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const db = new Database(dbPath);

  // 启用 WAL 模式提高并发性能，设置 busy 超时与外键约束
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  // 初始化图元数据与 Y.Doc 二进制状态表
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
  `);

  return db;
}
