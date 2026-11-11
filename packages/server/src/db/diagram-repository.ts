import type Database from 'better-sqlite3';
import * as Y from 'yjs';
import type {
  AiBatchEntityDiff,
  AiBatchRecord,
  AiBatchStatus,
  DiagramSummary,
  SnapshotSummary,
} from '@flowstudio/shared';

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

interface AiBatchRow {
  batch_id: string;
  diagram_id: string;
  agent_name: string | null;
  summary: string;
  status: string;
  diffs: string;
  created_at: string;
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
    options: { syncYDocTitle?: boolean } = {},
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

    // 如果标题变动且存在 Y.Doc 二进制状态，同步更新内部 Y.Doc 的 meta.title。
    // 在线文档存在时必须由调用方经 DocumentWriter 写入 Live Doc，跳过此处冷写，
    // 否则冷/热两份状态会并发 set 同名键，合并结果不可预期。
    if (options.syncYDocTitle !== false && input.title !== undefined && input.title.trim() !== existing.title) {
      const rawState = this.getYDocState(id);
      if (rawState) {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, rawState);
        doc.getMap('meta').set('title', title);
        // 走增量合并落库，避免在线协同期间被整包覆盖
        this.saveYDocState(id, Y.encodeStateAsUpdate(doc));
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
   * 保存 Y.Doc 二进制状态更新（CRDT 增量合并写回）
   *
   * 防覆盖关键点：若库中已有状态，必须通过 `Y.mergeUpdates` 合并后再落库，
   * 严禁整包 `SET ydoc_state = excluded.ydoc_state`，否则在线同事未落库的改动会被静默冲掉。
   * 同时若图表已被删除（行不存在），直接丢弃这次残余防抖写入，杜绝“删图复活”。
   */
  saveYDocState(id: string, update: Uint8Array, titleFromMeta?: string): void {
    const existing = this.db
      .prepare<[string], { ydoc_state: Buffer | null }>(`SELECT ydoc_state FROM diagrams WHERE id = ?`)
      .get(id);

    if (!existing) {
      // 图表已删除：忽略尚未落库的防抖残余更新
      return;
    }

    const merged =
      existing.ydoc_state && existing.ydoc_state.byteLength > 0
        ? Y.mergeUpdates([new Uint8Array(existing.ydoc_state), update])
        : update;

    const now = new Date().toISOString();
    const cleanTitle = titleFromMeta?.trim();

    if (cleanTitle && cleanTitle.length > 0) {
      this.db
        .prepare(
          `UPDATE diagrams SET ydoc_state = ?, title = ?, updated_at = ? WHERE id = ?`,
        )
        .run(Buffer.from(merged), cleanTitle, now, id);
    } else {
      this.db
        .prepare(`UPDATE diagrams SET ydoc_state = ?, updated_at = ? WHERE id = ?`)
        .run(Buffer.from(merged), now, id);
    }
  }

  /**
   * 仅替换二进制状态，不触碰 updated_at。
   * 供加载期压缩使用：维护动作不应伪装成用户的协作编辑记录。
   */
  replaceYDocState(id: string, update: Uint8Array): void {
    this.db
      .prepare(`UPDATE diagrams SET ydoc_state = ? WHERE id = ?`)
      .run(Buffer.from(update), id);
  }

  /**
   * 为指定图表创建历史版本快照（冷文档路径，直接读取 SQLite 状态）
   *
   * 在线文档享有 500ms~2s 的落库防抖窗口，此时 SQLite 可能落后于 Live Doc。
   * 服务端在线场景请改用 `DocumentWriter.createSnapshot`，由它优先截取 Live Doc 最新状态。
   */
  createSnapshot(
    diagramId: string,
    label: string,
    triggerType: 'manual' | 'ai_batch' | 'auto' = 'manual'
  ): SnapshotSummary | null {
    const currentState = this.getYDocState(diagramId);
    if (!currentState) return null;
    return this.createSnapshotFromState(diagramId, currentState, label, triggerType);
  }

  /**
   * 使用调用方提供的 Y.Doc 状态创建快照（供在线优先路径复用）
   */
  createSnapshotFromState(
    diagramId: string,
    state: Uint8Array,
    label: string,
    triggerType: 'manual' | 'ai_batch' | 'auto' = 'manual'
  ): SnapshotSummary {
    const snapshotId = `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const cleanLabel = label.trim() || '版本快照';

    const stmt = this.db.prepare(`
      INSERT INTO snapshots (id, diagram_id, ydoc_state, label, trigger_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(snapshotId, diagramId, Buffer.from(state), cleanLabel, triggerType, now);

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
   * 查询快照归属的图表 ID（跨图恢复校验）
   */
  getSnapshotDiagramId(snapshotId: string): string | null {
    const stmt = this.db.prepare<[string], { diagram_id: string }>(`
      SELECT diagram_id FROM snapshots WHERE id = ?
    `);
    const row = stmt.get(snapshotId);
    return row?.diagram_id ?? null;
  }

  /**
   * 写入一条 AI 批次账本记录（已存在则覆盖）
   */
  insertAiBatch(record: AiBatchRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO ai_batches (batch_id, diagram_id, agent_name, summary, status, diffs, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id) DO UPDATE SET
        agent_name = excluded.agent_name,
        summary = excluded.summary,
        status = excluded.status,
        diffs = excluded.diffs
    `);
    stmt.run(
      record.batchId,
      record.diagramId,
      record.agentName ?? null,
      record.summary,
      record.status,
      JSON.stringify(record.diffs),
      record.createdAt,
    );
  }

  /**
   * 查询指定图表最近的 AI 批次（含实体级 Diff 明细）
   *
   * 保留策略：账本表按图永久保留全部批次，查询端只取最近 `limit` 条；
   * 历史行不会自动清理（撤回能力依赖账本），如需回收空间由运维按图/按时间归档。
   */
  listAiBatches(diagramId: string, limit = 20): AiBatchRecord[] {
    const stmt = this.db.prepare<[string, number], AiBatchRow>(`
      SELECT batch_id, diagram_id, agent_name, summary, status, diffs, created_at
      FROM ai_batches
      WHERE diagram_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(diagramId, limit).map((row) => this.mapAiBatchRow(row));
  }

  /**
   * 查询指定图表的单个 AI 批次
   */
  getAiBatch(diagramId: string, batchId: string): AiBatchRecord | null {
    const stmt = this.db.prepare<[string, string], AiBatchRow>(`
      SELECT batch_id, diagram_id, agent_name, summary, status, diffs, created_at
      FROM ai_batches
      WHERE diagram_id = ? AND batch_id = ?
    `);
    const row = stmt.get(diagramId, batchId);
    return row ? this.mapAiBatchRow(row) : null;
  }

  /**
   * 更新批次状态与 Diff 明细（撤回后回写账本）
   */
  updateAiBatch(batchId: string, status: AiBatchStatus, diffs: AiBatchEntityDiff[]): void {
    this.db
      .prepare(`UPDATE ai_batches SET status = ?, diffs = ? WHERE batch_id = ?`)
      .run(status, JSON.stringify(diffs), batchId);
  }

  private mapAiBatchRow(row: AiBatchRow): AiBatchRecord {
    let diffs: AiBatchEntityDiff[] = [];
    try {
      const parsed = JSON.parse(row.diffs);
      if (Array.isArray(parsed)) diffs = parsed as AiBatchEntityDiff[];
    } catch {
      diffs = [];
    }
    return {
      batchId: row.batch_id,
      diagramId: row.diagram_id,
      agentName: row.agent_name ?? undefined,
      summary: row.summary,
      status: (row.status as AiBatchStatus) ?? 'active',
      diffs,
      createdAt: row.created_at,
    };
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
