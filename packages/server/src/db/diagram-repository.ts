import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';
import type { DiagramSummary } from '@flowstudio/shared';

interface DiagramRow {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  ydoc_state: Buffer | null;
  created_at: string;
  updated_at: string;
}

export class DiagramRepository {
  constructor(private db: Database.Database) {}

  /**
   * 查询所有图表列表，支持按标题模糊搜索
   */
  listDiagrams(searchQuery?: string): DiagramSummary[] {
    let rows: DiagramRow[];
    if (searchQuery && searchQuery.trim().length > 0) {
      const stmt = this.db.prepare<[string], DiagramRow>(`
        SELECT id, title, description, thumbnail, created_at, updated_at
        FROM diagrams
        WHERE title LIKE ?
        ORDER BY updated_at DESC
      `);
      rows = stmt.all(`%${searchQuery.trim()}%`);
    } else {
      const stmt = this.db.prepare<[], DiagramRow>(`
        SELECT id, title, description, thumbnail, created_at, updated_at
        FROM diagrams
        ORDER BY updated_at DESC
      `);
      rows = stmt.all();
    }

    return rows.map((r) => this.mapRowToSummary(r));
  }

  /**
   * 根据 ID 查询图表元数据
   */
  getDiagramById(id: string): DiagramSummary | null {
    const stmt = this.db.prepare<[string], DiagramRow>(`
      SELECT id, title, description, thumbnail, created_at, updated_at
      FROM diagrams
      WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? this.mapRowToSummary(row) : null;
  }

  /**
   * 创建新图表
   */
  createDiagram(input: {
    id?: string;
    title: string;
    description?: string;
    thumbnail?: string;
  }): DiagramSummary {
    const id = input.id ?? `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const title = input.title.trim();
    const description = input.description?.trim() ?? '';
    const thumbnail = input.thumbnail ?? '';

    // 初始化一个空的 Y.Doc 并写入初始标题
    const doc = new Y.Doc();
    doc.getMap('meta').set('title', title);
    const initialUpdate = Buffer.from(Y.encodeStateAsUpdate(doc));

    const stmt = this.db.prepare(`
      INSERT INTO diagrams (id, title, description, thumbnail, ydoc_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, title, description, thumbnail, initialUpdate, now, now);

    return {
      id,
      title,
      description,
      thumbnail,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 更新图表元数据（标题、描述、缩略图）
   */
  updateDiagram(
    id: string,
    input: { title?: string; description?: string; thumbnail?: string },
  ): DiagramSummary | null {
    const existing = this.getDiagramById(id);
    if (!existing) return null;

    const title = input.title !== undefined ? input.title.trim() : existing.title;
    const description = input.description !== undefined ? input.description.trim() : existing.description;
    const thumbnail = input.thumbnail !== undefined ? input.thumbnail : existing.thumbnail;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE diagrams
      SET title = ?, description = ?, thumbnail = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(title, description, thumbnail, now, id);

    // 如果标题变动且存在 Y.Doc 二进制状态，同步更新内部 Y.Doc 的 meta.title
    if (input.title !== undefined && input.title.trim() !== existing.title) {
      const rawState = this.getYDocState(id);
      if (rawState) {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, rawState);
        doc.getMap('meta').set('title', title);
        const nextUpdate = Buffer.from(Y.encodeStateAsUpdate(doc));
        this.db.prepare(`UPDATE diagrams SET ydoc_state = ? WHERE id = ?`).run(nextUpdate, id);
      }
    }

    return {
      id,
      title,
      description,
      thumbnail,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  /**
   * 删除指定图表
   */
  deleteDiagram(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM diagrams WHERE id = ?`);
    const info = stmt.run(id);
    return info.changes > 0;
  }

  /**
   * 复制图表（深拷贝 Y.Doc 状态，标题追加“ (副本)”）
   */
  duplicateDiagram(sourceId: string): DiagramSummary | null {
    const src = this.getDiagramById(sourceId);
    if (!src) return null;

    const newId = `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const newTitle = `${src.title} (副本)`;

    let nextUpdateBuffer: Buffer;
    const srcState = this.getYDocState(sourceId);
    if (srcState) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, srcState);
      doc.getMap('meta').set('title', newTitle);
      nextUpdateBuffer = Buffer.from(Y.encodeStateAsUpdate(doc));
    } else {
      const doc = new Y.Doc();
      doc.getMap('meta').set('title', newTitle);
      nextUpdateBuffer = Buffer.from(Y.encodeStateAsUpdate(doc));
    }

    const stmt = this.db.prepare(`
      INSERT INTO diagrams (id, title, description, thumbnail, ydoc_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(newId, newTitle, src.description, src.thumbnail, nextUpdateBuffer, now, now);

    return {
      id: newId,
      title: newTitle,
      description: src.description,
      thumbnail: src.thumbnail,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 读取 Y.Doc 二进制状态
   */
  getYDocState(id: string): Uint8Array | null {
    const stmt = this.db.prepare<[string], { ydoc_state: Buffer | null }>(`
      SELECT ydoc_state FROM diagrams WHERE id = ?
    `);
    const row = stmt.get(id);
    if (!row || !row.ydoc_state) return null;
    return new Uint8Array(row.ydoc_state);
  }

  /**
   * 保存 Y.Doc 二进制状态更新（支持 ON CONFLICT 插入保底）
   */
  saveYDocState(id: string, update: Uint8Array, titleFromMeta?: string): void {
    const now = new Date().toISOString();
    const buf = Buffer.from(update);

    if (titleFromMeta && titleFromMeta.trim().length > 0) {
      const stmt = this.db.prepare(`
        INSERT INTO diagrams (id, title, description, thumbnail, ydoc_state, created_at, updated_at)
        VALUES (?, ?, '', '', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          ydoc_state = excluded.ydoc_state,
          title = excluded.title,
          updated_at = excluded.updated_at
      `);
      stmt.run(id, titleFromMeta.trim(), buf, now, now);
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO diagrams (id, title, description, thumbnail, ydoc_state, created_at, updated_at)
        VALUES (?, '未命名流程图', '', '', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          ydoc_state = excluded.ydoc_state,
          updated_at = excluded.updated_at
      `);
      stmt.run(id, buf, now, now);
    }
  }

  private mapRowToSummary(row: DiagramRow): DiagramSummary {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      thumbnail: row.thumbnail,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
