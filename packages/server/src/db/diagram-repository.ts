import type Database from 'better-sqlite3';
import * as Y from 'yjs';
import type { DiagramSummary, SnapshotSummary } from '@flowstudio/shared';

interface SnapshotRow {
  id: string;
  diagram_id: string;
  label: string;
  trigger_type: string;
  ydoc_state: Buffer;
  created_at: string;
}

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

  /**
   * 为指定图表创建历史版本快照
   */
  createSnapshot(
    diagramId: string,
    label: string,
    triggerType: 'manual' | 'ai_batch' | 'auto' = 'manual'
  ): SnapshotSummary | null {
    const currentState = this.getYDocState(diagramId);
    if (!currentState) return null;

    const snapshotId = `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const cleanLabel = label.trim() || '版本快照';

    const stmt = this.db.prepare(`
      INSERT INTO snapshots (id, diagram_id, ydoc_state, label, trigger_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(snapshotId, diagramId, Buffer.from(currentState), cleanLabel, triggerType, now);

    return {
      id: snapshotId,
      diagramId,
      label: cleanLabel,
      triggerType,
      createdAt: now,
    };
  }

  /**
   * 查询指定图表的所有历史快照列表 (按时间倒序)
   */
  listSnapshots(diagramId: string): SnapshotSummary[] {
    const stmt = this.db.prepare<[string], SnapshotRow>(`
      SELECT id, diagram_id, label, trigger_type, created_at
      FROM snapshots
      WHERE diagram_id = ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(diagramId);
    return rows.map((r) => ({
      id: r.id,
      diagramId: r.diagram_id,
      label: r.label,
      triggerType: r.trigger_type as 'manual' | 'ai_batch' | 'auto',
      createdAt: r.created_at,
    }));
  }

  /**
   * 读取指定快照的二进制 Y.Doc 状态
   */
  getSnapshotState(snapshotId: string): Uint8Array | null {
    const stmt = this.db.prepare<[string], { ydoc_state: Buffer }>(`
      SELECT ydoc_state FROM snapshots WHERE id = ?
    `);
    const row = stmt.get(snapshotId);
    if (!row || !row.ydoc_state) return null;
    return new Uint8Array(row.ydoc_state);
  }

  /**
   * 将指定快照无损差异恢复写回当前文档
   * 计算目标快照与当前版本的差异，作为一次普通 Yjs 修改写回，实现在线协作者实时平滑同步且可撤销
   */
  restoreSnapshot(diagramId: string, snapshotId: string): { success: boolean; error?: string } {
    const targetState = this.getSnapshotState(snapshotId);
    if (!targetState) {
      return { success: false, error: '目标快照不存在' };
    }

    const currentState = this.getYDocState(diagramId);
    if (!currentState) {
      return { success: false, error: '目标图表不存在' };
    }

    // 载入快照文档与当前文档
    const snapDoc = new Y.Doc();
    Y.applyUpdate(snapDoc, targetState);

    const currDoc = new Y.Doc();
    Y.applyUpdate(currDoc, currentState);

    const snapNodesMap = snapDoc.getMap<Y.Map<unknown>>('nodes');
    const snapEdgesMap = snapDoc.getMap<Y.Map<unknown>>('edges');
    const snapMetaMap = snapDoc.getMap<unknown>('meta');

    const currNodesMap = currDoc.getMap<Y.Map<unknown>>('nodes');
    const currEdgesMap = currDoc.getMap<Y.Map<unknown>>('edges');
    const currMetaMap = currDoc.getMap<unknown>('meta');

    // 在普通事务中应用差异写回
    currDoc.transact(() => {
      // 1. 同步 Meta
      const snapTitle = snapMetaMap.get('title');
      if (typeof snapTitle === 'string') {
        currMetaMap.set('title', snapTitle);
      }

      // 2. 覆盖与添加快照中的节点
      const targetNodeIds = new Set<string>();
      snapNodesMap.forEach((nodeMap, id) => {
        targetNodeIds.add(id);
        let currNodeMap = currNodesMap.get(id);
        if (!currNodeMap) {
          currNodeMap = new Y.Map<unknown>();
          currNodesMap.set(id, currNodeMap);
        }
        nodeMap.forEach((val, key) => {
          currNodeMap!.set(key, val);
        });
      });

      // 删除当前文档中多出的不存在于快照的节点
      const currNodeIds = Array.from(currNodesMap.keys());
      for (const id of currNodeIds) {
        if (!targetNodeIds.has(id)) {
          currNodesMap.delete(id);
        }
      }

      // 3. 覆盖与添加快照中的连线
      const targetEdgeIds = new Set<string>();
      snapEdgesMap.forEach((edgeMap, id) => {
        targetEdgeIds.add(id);
        let currEdgeMap = currEdgesMap.get(id);
        if (!currEdgeMap) {
          currEdgeMap = new Y.Map<unknown>();
          currEdgesMap.set(id, currEdgeMap);
        }
        edgeMap.forEach((val, key) => {
          currEdgeMap!.set(key, val);
        });
      });

      // 删除多余连线
      const currEdgeIds = Array.from(currEdgesMap.keys());
      for (const id of currEdgeIds) {
        if (!targetEdgeIds.has(id)) {
          currEdgesMap.delete(id);
        }
      }
    }, 'snapshot-restore');

    // 持久化更新
    const nextUpdate = Y.encodeStateAsUpdate(currDoc);
    const snapTitle = snapMetaMap.get('title');
    this.saveYDocState(
      diagramId,
      nextUpdate,
      typeof snapTitle === 'string' ? snapTitle : undefined
    );

    return { success: true };
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
