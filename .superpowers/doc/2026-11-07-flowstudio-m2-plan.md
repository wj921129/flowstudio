# FlowStudio M2（服务端底座与实时协同）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 Node 22 + Fastify + Hocuspocus (Yjs CRDT) + SQLite 构建单进程服务端数据底座与局域网多人实时协同系统，实现多端实时光标与选区感知、分布式独立撤销、图文档管理（列表/缩略图/新建/重命名/复制/删除/搜索）及服务重启无损恢复。

**Architecture:**
1. **单进程服务端（`packages/server`）**：Node 22 + Fastify 5 单端口同时承载 REST API（`/api/diagrams`）、Hocuspocus WebSocket 协同通道（`/collaboration`）以及生产环境前端静态资源托管；底层采用 `better-sqlite3`（开启 WAL 模式）将图元数据、SVG 缩略图与 `Y.Doc` 二进制状态落盘至单个 SQLite 文件。
2. **Yjs 唯一事实源（SSOT）**：每张图对应一个 `Y.Doc`，顶层划分为 `meta` (`Y.Map`)、`nodes` (`Y.Map<id, Y.Map>`)、`edges` (`Y.Map<id, Y.Map>`) 及预留的 `lanes` (`Y.Map`)。`YjsDiagramBridge` 负责将本地 16 项画布动作（增删改、成组/解组、对齐/分布、粘贴等）封装为带 `localClientId` origin 的 Yjs 事务，并通过 `observeDeep` 驱动 Zustand 视图层。
3. **协同感知与独立撤销（`packages/web`）**：通过 Hocuspocus Awareness 广播画布世界坐标光标（`cursor`）、选中节点（`selectedNodeIds`）及免登录身份（`clientId`、`nickname`、`color`）；通过 `Y.UndoManager` 严格限定 `trackedOrigins: new Set([localClientId])`，实现“只撤自己、不撤同事”。

**Tech Stack:**
- Runtime & Monorepo: Node.js 22 LTS, pnpm workspaces, TypeScript 5.7 (`strict: true`)
- Backend: Fastify 5 (`fastify`, `@fastify/websocket`, `@fastify/static`, `@fastify/cors`), `@hocuspocus/server` 2.x, `better-sqlite3` 11.x, `yjs` 13.x
- Frontend: React 19, Vite 6, `@xyflow/react` 12.x, `@hocuspocus/provider` 2.x, `yjs` 13.x, Zustand 5, Tailwind CSS v4, Lucide React
- Shared & Testing: `zod` 3.x, `vitest` 3.x, `ws`

**Spec:** [.superpowers/doc/2026-11-06-flow-studio-design.md](file:///.superpowers/doc/2026-11-06-flow-studio-design.md)（核心对应章节：§2 目标 2/6、§5.1 整体架构、§5.2 技术栈、§5.3 数据模型、§5.7 实时协作细节、§5.8 免登录轻量身份、§5.10 图列表与版本快照、§5.11 编辑器布局、§5.12 协同选区模型、§6 里程碑 M2）

---

## Global Constraints

- **Node 22 + Single Process**: 服务端运行于单个 Node.js 进程，单端口同时服务 HTTP API、WebSocket 协同与静态文件，零外部数据库或云服务依赖。
- **TypeScript Strict & ESM**: 全仓 `strict: true`，禁止 `any`（第三方无类型库过渡除外）；`packages/shared` 与 `packages/server` 保持 ESM（相对导入带 `.js` 后缀）。
- **File Naming Convention**: 严格延续 M1 规范——**所有文件名采用 `kebab-case.ts` / `kebab-case.tsx`**，React 组件导出名采用 `PascalCase`。
- **Design Tokens & Theme**: 所有新增 UI（看板页、弹窗、协同光标、在线头像、连接状态徽标）必须使用 `packages/web/src/styles/tokens.css` 中的 `--fs-*` CSS 变量，禁止硬编码颜色，完整支持亮色/暗色主题切换。
- **UI 文案与交互**: 全中文界面、日志与错误提示；局域网零外网 CDN 依赖。
- **Yjs as SSOT & Isolated Undo**: 图核心数据唯一事实源为 `Y.Doc`，Zustand 仅保留视图缓存与纯本地 UI 状态；`Y.UndoManager` 必须只追踪当前客户端 `clientId` 的事务。

---

## Review Focus

1. **未同步完成前的空状态覆盖风险**：客户端刚进入 `/#/diagram/:id` 时本地 `Y.Doc` 为空，若在 Hocuspocus `synced` 事件触发前执行写操作或初始化覆盖，会清空服务端已有图数据。
   *防范*：`CollaborationProvider` 必须在 `isSynced === true` 后才解除画布只读锁并允许提交本地事务。
2. **协同并发删除节点的悬挂连线（Dangling Edges）**：用户 A 删除节点 `N1` 的同时，用户 B 正在创建指向 `N1` 的连线 `E1`。
   *防范*：`YjsDiagramBridge.toReactFlowState()` 在组装状态时自动过滤 `source` 或 `target` 节点不存在的孤立连线；删除节点事务内同步清理关联连线。
3. **高频拖拽引发的 CRDT 膨胀与撤销栈碎裂**：节点拖拽期间每帧触发 `onNodesChange`，若每帧写 `Y.Doc` 事务，会导致撤销一次只退 1px 且阻塞 WebSocket。
   *防范*：拖拽过程（`dragging === true`）仅更新 Zustand 本地瞬态坐标以保证 60fps 丝滑渲染，而在拖拽结束（`dragging === false`）或 `onNodeDragStop` 时一次性将最终坐标写入 `Y.Doc` 事务并调用 `undoManager.stopCapturing()`。
4. **父子分组节点（Group）拓扑顺序错乱**：React Flow 要求带 `parentId` 的子节点必须在父节点之后出现在 `nodes` 数组中，而 `Y.Map` 遍历顺序不固定。
   *防范*：`YjsDiagramBridge.toReactFlowState()` 输出 `nodes` 前强制执行拓扑排序（Group / 父容器节点排在子节点之前）。
5. **SQLite 并发锁与外键冲突**：Hocuspocus 直接通过房间名（`diagramId`）落盘二进制状态时，若 `diagrams` 表尚无对应记录会导致外键报错或看板页查不到该图。
   *防范*：`SQLite` 开启 `WAL` 模式与 `busy_timeout = 5000`；`saveYDocUpdate` 采用 `INSERT INTO diagrams ... ON CONFLICT(id) DO UPDATE` 确保图表记录始终存在。

---

## File Structure

```text
flowstudio/
├── package.json                                              # [Modify] 增加 test, dev:server, dev:all 脚本与 vitest 依赖
├── vitest.config.ts                                          # [Create] 根级 Vitest 测试配置（覆盖 shared / server / web）
├── scripts/
│   └── dev-all.bat                                           # [Create] Windows 局域网开发一键启动脚本
├── packages/
│   ├── shared/
│   │   ├── package.json                                      # [Modify] 增加 zod 依赖
│   │   ├── src/
│   │   │   ├── index.ts                                      # [Modify] 导出协同类型与 Zod schemas
│   │   │   ├── types.ts                                      # [Modify] 增加 DiagramMeta, UserIdentity, AwarenessState 等协同类型
│   │   │   └── schemas/
│   │   │       ├── index.ts                                  # [Create] Schema 统一出口
│   │   │       └── diagram-schema.ts                         # [Create] 节点、连线、图表 CRUD 与身份校验 Zod Schema
│   │   └── tests/
│   │       └── schemas.test.ts                               # [Create] Shared Zod Schema 单元测试
│   ├── server/
│   │   ├── package.json                                      # [Modify] 增加 fastify, @hocuspocus/server, better-sqlite3, yjs, ws
│   │   ├── src/
│   │   │   ├── index.ts                                      # [Modify] 服务启动入口（端口监听、优雅退出）
│   │   │   ├── server.ts                                     # [Create] Fastify 实例装配（CORS、REST、WS、Static）
│   │   │   ├── db/
│   │   │   │   ├── database.ts                               # [Create] SQLite 初始化、WAL 配置与建表迁移
│   │   │   │   └── diagram-repository.ts                     # [Create] 图表 CRUD、复制（Duplicate）、Y.Doc 二进制读写与快照预留
│   │   │   ├── collaboration/
│   │   │   │   ├── hocuspocus.ts                             # [Create] Hocuspocus Server 实例装配
│   │   │   │   └── sqlite-extension.ts                       # [Create] Hocuspocus 自定义 SQLite 持久化扩展
│   │   │   └── routes/
│   │   │       └── diagrams.ts                               # [Create] /api/diagrams REST 路由（列表/搜索/创建/详情/更新/删除/复制）
│   │   └── tests/
│   │       ├── diagram-repository.test.ts                    # [Create] SQLite 仓储层测试（含复制与二进制读写）
│   │       ├── hocuspocus.test.ts                            # [Create] Hocuspocus 加载与落盘测试
│   │       ├── api.test.ts                                   # [Create] Fastify REST API 集成测试
│   │       └── e2e-collaboration.test.ts                     # [Create] 5 客户端并发协同 + 服务重启无损恢复 E2E 测试
│   └── web/
│       ├── package.json                                      # [Modify] 增加 yjs, @hocuspocus/provider 依赖
│       ├── vite.config.ts                                    # [Modify] 配置 /api 与 /collaboration 开发代理
│       ├── src/
│       │   ├── app/
│       │   │   └── app.tsx                                   # [Modify] 接入 Hash 路由（#/ 看板页 与 #/diagram/:id 编辑器页）
│       │   ├── lib/
│       │   │   └── api-client.ts                             # [Create] 图管理 REST API 前端请求封装
│       │   ├── stores/
│       │   │   └── flow-store.ts                             # [Modify] 绑定 YjsDiagramBridge 与 CollaborativeUndoManager，全量 16 项动作事务化
│       │   ├── hooks/
│       │   │   └── use-persistence.ts                        # [Modify] 协同模式下由 Yjs 接管持久化，自动上报缩略图与标题
│       │   └── features/
│       │       ├── collaboration/
│       │       │   ├── types.ts                              # [Create] 前端协同桥接与连接状态类型
│       │       │   ├── yjs-doc-bridge.ts                     # [Create] Y.Doc <-> React Flow 双向映射桥（含父子拓扑排序与悬挂边过滤）
│       │       │   ├── undo-manager.ts                       # [Create] 基于 localClientId 的独立撤销重做管理器
│       │       │   ├── user-identity.ts                      # [Create] 免登录身份生成、颜色分配与 localStorage 持久化
│       │       │   ├── use-awareness.ts                      # [Create] Awareness 光标世界坐标与选中节点同步 Hook
│       │       │   ├── collaboration-provider.tsx            # [Create] HocuspocusProvider 容器与状态注入上下文
│       │       │   ├── collaborative-cursors.tsx             # [Create] 画布远端用户平滑彩色光标与昵称气泡图层
│       │       │   ├── collaborator-avatars.tsx              # [Create] TopBar 在线协作者头像组与个人昵称触发器
│       │       │   └── nickname-modal.tsx                    # [Create] 首次访问填写昵称 / 修改昵称弹窗
│       │       ├── dashboard/
│       │       │   ├── dashboard-page.tsx                    # [Create] 图表管理首页（搜索、新建、卡片网格）
│       │       │   ├── diagram-card.tsx                      # [Create] 图表卡片（SVG 缩略图预览、重命名、复制、删除）
│       │       │   └── create-diagram-modal.tsx              # [Create] 新建/重命名图表弹窗
│       │       ├── canvas/
│       │       │   ├── flow-canvas.tsx                       # [Modify] 挂载 CollaborativeCursors、上报鼠标世界坐标与选中状态
│       │       │   └── custom-nodes/
│       │       │       └── base-node-wrapper.tsx             # [Modify] 渲染远端协作者选中高亮彩色外框与昵称角标
│       │       └── topbar/
│       │           └── top-bar.tsx                           # [Modify] 增加返回看板按钮、连接状态指示、在线头像、分享链接、标题同步
│       └── tests/
│           ├── yjs-doc-bridge.test.ts                        # [Create] Yjs 双向同步、成组排序与悬挂边清理测试
│           ├── undo-manager.test.ts                          # [Create] 多端交错编辑下仅撤销本人操作的单元测试
│           ├── user-identity.test.ts                         # [Create] 免登录身份与首次标记单元测试
│           ├── store-yjs-integration.test.ts                 # [Create] Zustand Store 16 项动作与 Yjs 桥接集成测试
│           └── api-client.test.ts                            # [Create] 前端 API 客户端单元测试
```

---

## Task Breakdown

### Task 1: 测试设施搭建与 `@flowstudio/shared` 协同契约层

**Files:**
- Create: `vitest.config.ts`
- Create: `packages/shared/src/schemas/diagram-schema.ts`
- Create: `packages/shared/src/schemas/index.ts`
- Create: `packages/shared/tests/schemas.test.ts`
- Modify: `package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `FlowNode`, `FlowEdge`, `FlowDiagram`, `FLOW_NODE_TYPES` from `packages/shared/src/types.ts`
- Produces:
  - Types in `@flowstudio/shared`:
    - `DiagramSummary`: `{ id: string; title: string; description: string; thumbnail: string; createdAt: string; updatedAt: string }`
    - `UserIdentity`: `{ clientId: string; nickname: string; color: string; isFirstVisit?: boolean }`
    - `AwarenessUserState`: `{ clientId: string; nickname: string; color: string; cursor: { x: number; y: number } | null; selectedNodeIds: string[] }`
  - Schemas in `@flowstudio/shared`:
    - `flowNodeSchema`, `flowEdgeSchema`, `flowDiagramSchema`
    - `createDiagramInputSchema`: `z.object({ title: z.string().trim().min(1).max(100), description: z.string().max(500).optional(), thumbnail: z.string().optional() })`
    - `updateDiagramInputSchema`: `z.object({ title: z.string().trim().min(1).max(100).optional(), description: z.string().max(500).optional(), thumbnail: z.string().optional() })`
    - `awarenessUserStateSchema`

- [ ] **Step 1: Write the failing test for shared schemas**

```ts
// packages/shared/tests/schemas.test.ts
import { describe, it, expect } from 'vitest';
import {
  flowNodeSchema,
  flowEdgeSchema,
  createDiagramInputSchema,
  updateDiagramInputSchema,
  awarenessUserStateSchema,
} from '../src/index.js';

describe('@flowstudio/shared schemas', () => {
  it('validates a standard FlowNode and rejects unknown node types', () => {
    const valid = flowNodeSchema.safeParse({
      id: 'node-1',
      type: 'process',
      position: { x: 120, y: 90 },
      data: { label: '订单校验', type: 'process' },
    });
    expect(valid.success).toBe(true);

    const invalid = flowNodeSchema.safeParse({
      id: 'node-2',
      type: 'invalid-type',
      position: { x: 0, y: 0 },
      data: { label: '错误', type: 'invalid-type' },
    });
    expect(invalid.success).toBe(false);
  });

  it('validates createDiagramInputSchema and rejects blank title', () => {
    expect(createDiagramInputSchema.safeParse({ title: '支付清算流程' }).success).toBe(true);
    expect(createDiagramInputSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('validates awarenessUserStateSchema with clientId, nickname, color, cursor, selectedNodeIds', () => {
    const state = {
      clientId: 'client-abc-123',
      nickname: '王工',
      color: '#6366F1',
      cursor: { x: 300, y: 450 },
      selectedNodeIds: ['node-1'],
    };
    expect(awarenessUserStateSchema.safeParse(state).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/tests/schemas.test.ts`
Expected: FAIL (`vitest` not installed or module exports missing)

- [ ] **Step 3: Install vitest & zod, implement types and schemas**

1. 在根目录安装 `vitest` (`pnpm add -D -w vitest`)，在 `packages/shared` 安装 `zod` (`pnpm --filter @flowstudio/shared add zod`)。
2. 创建 `vitest.config.ts`，配置路径别名 `@flowstudio/shared` 指向 `packages/shared/src/index.ts`。
3. 在 `packages/shared/src/types.ts` 中新增 `DiagramSummary`, `UserIdentity`, `AwarenessUserState` 及协同颜色常量 `COLLABORATOR_COLORS`。
4. 创建 `packages/shared/src/schemas/diagram-schema.ts` 与 `packages/shared/src/schemas/index.ts`，并在 `packages/shared/src/index.ts` 中通过 `.js` 扩展名导出。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/shared/tests/schemas.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts packages/shared
git commit -m "feat(shared): setup vitest and add zod schemas for diagram and awareness"
```

---

### Task 2: 服务端 SQLite 数据库与图表仓储层（含复制与二进制状态存储）

**Files:**
- Create: `packages/server/src/db/database.ts`
- Create: `packages/server/src/db/diagram-repository.ts`
- Create: `packages/server/tests/diagram-repository.test.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: `DiagramSummary` from `@flowstudio/shared`, `Y.Doc` from `yjs`
- Produces:
  - `initDatabase(dbPath?: string): Database.Database`
  - `class DiagramRepository`:
    - `listDiagrams(searchQuery?: string): DiagramSummary[]`
    - `getDiagramById(id: string): DiagramSummary | null`
    - `createDiagram(input: { id?: string; title: string; description?: string; thumbnail?: string }): DiagramSummary`
    - `updateDiagram(id: string, input: { title?: string; description?: string; thumbnail?: string }): DiagramSummary | null`
    - `deleteDiagram(id: string): boolean`
    - `duplicateDiagram(id: string): DiagramSummary | null`
    - `getYDocState(id: string): Uint8Array | null`
    - `saveYDocState(id: string, update: Uint8Array, titleFromMeta?: string): void`

- [ ] **Step 1: Write the failing test for DiagramRepository**

```ts
// packages/server/tests/diagram-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import type Database from 'better-sqlite3';

describe('DiagramRepository', () => {
  let db: Database.Database;
  let repo: DiagramRepository;

  beforeEach(() => {
    db = initDatabase(':memory:');
    repo = new DiagramRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('supports create, search list, update, and delete', () => {
    const d1 = repo.createDiagram({ title: '订单履约主流程', description: '核心链路' });
    repo.createDiagram({ title: '退货逆向流程' });

    expect(repo.listDiagrams().length).toBe(2);
    expect(repo.listDiagrams('退货').length).toBe(1);

    const updated = repo.updateDiagram(d1.id, { title: '订单履约 V2', thumbnail: '<svg></svg>' });
    expect(updated?.title).toBe('订单履约 V2');
    expect(updated?.thumbnail).toBe('<svg></svg>');

    expect(repo.deleteDiagram(d1.id)).toBe(true);
    expect(repo.getDiagramById(d1.id)).toBeNull();
  });

  it('persists Y.Doc state and duplicates diagram with deep-copied Y.Doc state', () => {
    const src = repo.createDiagram({ title: '原流程图', thumbnail: '<svg id="thumb"/>' });

    const doc = new Y.Doc();
    doc.getMap('meta').set('title', '原流程图');
    const nodes = doc.getMap('nodes');
    const n1 = new Y.Map();
    n1.set('id', 'node-1');
    n1.set('label', '开始');
    nodes.set('node-1', n1);

    repo.saveYDocState(src.id, Y.encodeStateAsUpdate(doc));

    const copy = repo.duplicateDiagram(src.id);
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(src.id);
    expect(copy!.title).toBe('原流程图 (副本)');
    expect(copy!.thumbnail).toBe('<svg id="thumb"/>');

    const copyUpdate = repo.getYDocState(copy!.id);
    expect(copyUpdate).not.toBeNull();
    const copyDoc = new Y.Doc();
    Y.applyUpdate(copyDoc, copyUpdate!);
    expect(copyDoc.getMap('meta').get('title')).toBe('原流程图 (副本)');
    expect(copyDoc.getMap('nodes').has('node-1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/server/tests/diagram-repository.test.ts`
Expected: FAIL (Cannot find module `../src/db/database.js`)

- [ ] **Step 3: Implement SQLite database schema and DiagramRepository**

1. 在 `packages/server` 安装 `better-sqlite3`, `@types/better-sqlite3`, `yjs`。
2. 在 `packages/server/src/db/database.ts` 实现 `initDatabase`：
   - 开启 `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;`
   - 创建 `diagrams` 表（`id TEXT PRIMARY KEY`, `title TEXT NOT NULL`, `description TEXT NOT NULL DEFAULT ''`, `thumbnail TEXT NOT NULL DEFAULT ''`, `ydoc_state BLOB`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`）
   - 创建 `snapshots` 预留表（`id TEXT PRIMARY KEY`, `diagram_id TEXT NOT NULL`, `ydoc_state BLOB NOT NULL`, `label TEXT NOT NULL`, `trigger_type TEXT NOT NULL`, `created_at TEXT NOT NULL`, `FOREIGN KEY(diagram_id) REFERENCES diagrams(id) ON DELETE CASCADE`）
3. 在 `packages/server/src/db/diagram-repository.ts` 实现全部方法：
   - `saveYDocState`：若 `id` 尚不存在则自动插入默认行（防止直接连接 WebSocket room 时丢失记录），若存在则更新 `ydoc_state` 与 `updated_at`（若传入 `titleFromMeta` 则同步更新 `title`）。
   - `duplicateDiagram`：拷贝原记录的 `ydoc_state` 与 `thumbnail`，用 `Y.Doc` 加载后将 `meta.set('title', `${原title} (副本)`)` 重新编码写入新记录。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/server/tests/diagram-repository.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add packages/server pnpm-lock.yaml
git commit -m "feat(server): implement sqlite database and diagram repository with duplicate support"
```

---

### Task 3: Hocuspocus 协同网关与 SQLite 持久化扩展

**Files:**
- Create: `packages/server/src/collaboration/sqlite-extension.ts`
- Create: `packages/server/src/collaboration/hocuspocus.ts`
- Create: `packages/server/tests/hocuspocus.test.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: `DiagramRepository` from `packages/server/src/db/diagram-repository.ts`
- Produces:
  - `class SqlitePersistenceExtension implements Extension`
  - `createCollaborationServer(repo: DiagramRepository, options?: { debounce?: number }): Hocuspocus`

- [ ] **Step 1: Write the failing test for Hocuspocus SQLite persistence**

```ts
// packages/server/tests/hocuspocus.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { SqlitePersistenceExtension } from '../src/collaboration/sqlite-extension.js';

describe('SqlitePersistenceExtension', () => {
  let repo: DiagramRepository;
  let ext: SqlitePersistenceExtension;

  beforeEach(() => {
    const db = initDatabase(':memory:');
    repo = new DiagramRepository(db);
    ext = new SqlitePersistenceExtension(repo);
  });

  it('loads existing Y.Doc state from SQLite and stores updates back', async () => {
    const diagram = repo.createDiagram({ title: '初始标题' });
    const seedDoc = new Y.Doc();
    seedDoc.getMap('meta').set('title', '协同修改后标题');
    seedDoc.getMap('nodes').set('n1', new Y.Map([['id', 'n1']]));

    await ext.onStoreDocument({
      documentName: diagram.id,
      document: seedDoc,
    } as any);

    // 验证标题与二进制状态均已落盘
    expect(repo.getDiagramById(diagram.id)?.title).toBe('协同修改后标题');

    const targetDoc = new Y.Doc();
    await ext.onLoadDocument({
      documentName: diagram.id,
      document: targetDoc,
    } as any);

    expect(targetDoc.getMap('meta').get('title')).toBe('协同修改后标题');
    expect(targetDoc.getMap('nodes').has('n1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/server/tests/hocuspocus.test.ts`
Expected: FAIL (Cannot find module `../src/collaboration/sqlite-extension.js`)

- [ ] **Step 3: Implement SqlitePersistenceExtension and createCollaborationServer**

1. 在 `packages/server` 安装 `@hocuspocus/server`。
2. 实现 `SqlitePersistenceExtension`：
   - `onLoadDocument({ documentName, document })`：从 `repo.getYDocState(documentName)` 读取 `Uint8Array`，若非空则 `Y.applyUpdate(document, state)`；若为空且 `repo.getDiagramById(documentName)` 有记录，则初始化 `document.getMap('meta').set('title', record.title)`。
   - `onStoreDocument({ documentName, document })`：调用 `Y.encodeStateAsUpdate(document)`，读取 `document.getMap('meta').get('title')` 作为可选同步标题，调用 `repo.saveYDocState(documentName, update, metaTitle)`。
3. 实现 `createCollaborationServer(repo, options)`：装配 `new Hocuspocus({ debounce: options?.debounce ?? 500, maxDebounce: 2000, extensions: [new SqlitePersistenceExtension(repo)] })`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/server/tests/hocuspocus.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server pnpm-lock.yaml
git commit -m "feat(server): integrate hocuspocus server with sqlite persistence extension"
```

---

### Task 4: Fastify 单进程主服务 — REST API、WS 挂载与静态资源托管

**Files:**
- Create: `packages/server/src/routes/diagrams.ts`
- Create: `packages/server/src/server.ts`
- Create: `packages/server/tests/api.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: `DiagramRepository`, `createCollaborationServer`, `createDiagramInputSchema`, `updateDiagramInputSchema`
- Produces:
  - `buildServer(options?: { dbPath?: string; webDistPath?: string }): Promise<{ app: FastifyInstance; repo: DiagramRepository; hocuspocus: Hocuspocus }>`
  - REST Endpoints:
    - `GET /api/diagrams?q=` -> `{ diagrams: DiagramSummary[] }`
    - `POST /api/diagrams` -> `201 DiagramSummary`
    - `GET /api/diagrams/:id` -> `200 DiagramSummary | 404`
    - `PATCH /api/diagrams/:id` -> `200 DiagramSummary | 404`
    - `POST /api/diagrams/:id/duplicate` -> `201 DiagramSummary | 404`
    - `DELETE /api/diagrams/:id` -> `204 | 404`
  - WebSocket Endpoint: `GET /collaboration/:diagramId` (or `/collaboration`) handled via `hocuspocus.handleConnection`

- [ ] **Step 1: Write the failing test for Fastify REST API**

```ts
// packages/server/tests/api.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

describe('Diagrams REST API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const built = await buildServer({ dbPath: ':memory:' });
    app = built.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('completes full lifecycle: create, list/search, update, duplicate, and delete', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '风控审批图' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();

    const dupRes = await app.inject({
      method: 'POST',
      url: `/api/diagrams/${created.id}/duplicate`,
    });
    expect(dupRes.statusCode).toBe(201);
    expect(dupRes.json().title).toBe('风控审批图 (副本)');

    const listRes = await app.inject({ method: 'GET', url: '/api/diagrams?q=副本' });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().diagrams.length).toBe(1);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/diagrams/${created.id}`,
      payload: { title: '风控审批图 V2' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().title).toBe('风控审批图 V2');

    const delRes = await app.inject({ method: 'DELETE', url: `/api/diagrams/${created.id}` });
    expect(delRes.statusCode).toBe(204);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/server/tests/api.test.ts`
Expected: FAIL (Cannot find module `../src/server.js`)

- [ ] **Step 3: Implement Fastify server, REST routes, and WS handler**

1. 在 `packages/server` 安装 `fastify`, `@fastify/websocket`, `@fastify/cors`, `@fastify/static`, `ws`, `@types/ws`。
2. 实现 `packages/server/src/routes/diagrams.ts`，使用 `createDiagramInputSchema` 与 `updateDiagramInputSchema` 校验请求体，校验失败返回 `400 { error: '参数校验失败', details }`。
3. 实现 `packages/server/src/server.ts`：
   - 注册 `@fastify/cors` 与 `@fastify/websocket`。
   - 注册 `/collaboration` WebSocket 路由，将底层 `socket` 和 `request` 交给 `hocuspocus.handleConnection(socket, request)`。
   - 若 `webDistPath` 存在，注册 `@fastify/static` 托管前端构建产物。
   - `onClose` 钩子中关闭 `hocuspocus` 与 `db`。
4. 更新 `packages/server/src/index.ts`：默认监听 `0.0.0.0:3000`（支持 `PORT` 与 `DB_PATH` 环境变量），输出中文启动日志。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/server/tests/api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server pnpm-lock.yaml
git commit -m "feat(server): build fastify server with diagram rest routes and websocket gateway"
```

---

### Task 5: Yjs CRDT 双向数据桥接器（`YjsDiagramBridge`）

**Files:**
- Create: `packages/web/src/features/collaboration/types.ts`
- Create: `packages/web/src/features/collaboration/yjs-doc-bridge.ts`
- Create: `packages/web/tests/yjs-doc-bridge.test.ts`
- Modify: `packages/web/package.json`

**Interfaces:**
- Consumes: `FlowNode`, `FlowEdge` from `@flowstudio/shared`
- Produces:
  - `class YjsDiagramBridge`:
    - `constructor(doc: Y.Doc, options: { localClientId: string })`
    - `getDoc(): Y.Doc`
    - `getLocalClientId(): string`
    - `transact(fn: () => void, origin?: string): void`
    - `getTitle(): string` / `setTitle(title: string): void`
    - `setDiagram(nodes: FlowNode[], edges: FlowEdge[]): void`
    - `putNodes(nodes: FlowNode[]): void`
    - `patchNode(id: string, patch: Partial<FlowNode>): void`
    - `patchNodes(patches: Array<{ id: string; patch: Partial<FlowNode> }>): void`
    - `removeNodes(ids: string[]): void` (自动级联移除关联 edges)
    - `putEdges(edges: FlowEdge[]): void`
    - `patchEdge(id: string, patch: Partial<FlowEdge>): void`
    - `removeEdges(ids: string[]): void`
    - `toReactFlowState(): { nodes: FlowNode[]; edges: FlowEdge[]; title: string }`
    - `subscribe(listener: (state: { nodes: FlowNode[]; edges: FlowEdge[]; title: string }) => void): () => void`

- [ ] **Step 1: Write the failing test for YjsDiagramBridge**

```ts
// packages/web/tests/yjs-doc-bridge.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('YjsDiagramBridge', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let bridgeA: YjsDiagramBridge;
  let bridgeB: YjsDiagramBridge;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    bridgeA = new YjsDiagramBridge(docA, { localClientId: 'client-a' });
    bridgeB = new YjsDiagramBridge(docB, { localClientId: 'client-b' });

    docA.on('update', (update: Uint8Array) => Y.applyUpdate(docB, update));
    docB.on('update', (update: Uint8Array) => Y.applyUpdate(docA, update));
  });

  it('syncs nodes, edges, parent-child topological order, and filters dangling edges', () => {
    const childNode: FlowNode = {
      id: 'child-1',
      type: 'process',
      parentId: 'group-1',
      extent: 'parent',
      position: { x: 20, y: 40 },
      data: { label: '子节点', type: 'process', parentId: 'group-1' },
    };
    const groupNode: FlowNode = {
      id: 'group-1',
      type: 'group',
      position: { x: 100, y: 100 },
      width: 300,
      height: 200,
      data: { label: '分组容器', type: 'group', isFrame: true },
    };
    const validEdge: FlowEdge = {
      id: 'edge-1',
      source: 'child-1',
      target: 'group-1',
      type: 'orthogonal',
      data: { label: '连接', routingType: 'orthogonal' },
    };
    const danglingEdge: FlowEdge = {
      id: 'edge-ghost',
      source: 'child-1',
      target: 'non-existent-node',
    };

    // 故意先传入 child 再传入 group，验证输出时父容器自动排在前面
    bridgeA.setDiagram([childNode, groupNode], [validEdge, danglingEdge]);

    const stateB = bridgeB.toReactFlowState();
    expect(stateB.nodes.map((n) => n.id)).toEqual(['group-1', 'child-1']);
    expect(stateB.edges.map((e) => e.id)).toEqual(['edge-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/web/tests/yjs-doc-bridge.test.ts`
Expected: FAIL (Cannot find module `../src/features/collaboration/yjs-doc-bridge`)

- [ ] **Step 3: Implement YjsDiagramBridge**

1. 在 `packages/web` 安装 `yjs`, `@hocuspocus/provider`。
2. 实现 `packages/web/src/features/collaboration/yjs-doc-bridge.ts`：
   - 节点在 `doc.getMap('nodes')` 中以 `Y.Map` 存储：`id`, `type`, `position` (`{x, y}`), `data` (深拷贝纯对象), `parentId`, `extent`, `width`, `height`, `style`, `zIndex`。
   - 连线在 `doc.getMap('edges')` 中以 `Y.Map` 存储：`id`, `source`, `target`, `sourceHandle`, `targetHandle`, `type`, `data`, `label`, `animated`, `style`, `markerEnd`。
   - `toReactFlowState()`：
     1. 将所有 `Y.Map` 还原为 `FlowNode` 与 `FlowEdge`（剔除本地瞬态 `selected`/`dragging`）。
     2. 对 `nodes` 执行父子拓扑排序（无 `parentId` 或 `type === 'group'` 优先于引用它的子节点）。
     3. 过滤掉 `source` 或 `target` 不在 `nodeIds` 集合中的孤立连线。
   - 所有修改方法均包裹在 `this.doc.transact(() => { ... }, this.localClientId)` 中。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/web/tests/yjs-doc-bridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web pnpm-lock.yaml
git commit -m "feat(web): implement YjsDiagramBridge with topological sort and dangling edge filter"
```

---

### Task 6: 分布式协同撤销重做管理器（`CollaborativeUndoManager`）

**Files:**
- Create: `packages/web/src/features/collaboration/undo-manager.ts`
- Create: `packages/web/tests/undo-manager.test.ts`

**Interfaces:**
- Consumes: `Y.Doc` from `yjs`, `YjsDiagramBridge` from Task 5
- Produces:
  - `class CollaborativeUndoManager`:
    - `constructor(doc: Y.Doc, localClientId: string, captureTimeout?: number)`
    - `undo(): void`
    - `redo(): void`
    - `canUndo(): boolean`
    - `canRedo(): boolean`
    - `stopCapturing(): void`
    - `clear(): void`
    - `subscribe(listener: (state: { canUndo: boolean; canRedo: boolean }) => void): () => void`
    - `destroy(): void`

- [ ] **Step 1: Write the failing test for isolated collaborative undo/redo**

```ts
// packages/web/tests/undo-manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
import { CollaborativeUndoManager } from '../src/features/collaboration/undo-manager';

describe('CollaborativeUndoManager', () => {
  let doc: Y.Doc;
  let bridgeLocal: YjsDiagramBridge;
  let bridgeRemote: YjsDiagramBridge;
  let undoManager: CollaborativeUndoManager;

  beforeEach(() => {
    doc = new Y.Doc();
    bridgeLocal = new YjsDiagramBridge(doc, { localClientId: 'user-local' });
    bridgeRemote = new YjsDiagramBridge(doc, { localClientId: 'user-remote' });
    undoManager = new CollaborativeUndoManager(doc, 'user-local', 0);
  });

  it('only undoes and redoes local user operations while preserving remote user edits', () => {
    // 1. 本地用户创建 node-a
    bridgeLocal.putNodes([
      { id: 'node-a', type: 'process', position: { x: 0, y: 0 }, data: { label: 'A', type: 'process' } },
    ]);
    undoManager.stopCapturing();

    // 2. 远端用户创建 node-b 并修改 node-b
    bridgeRemote.putNodes([
      { id: 'node-b', type: 'decision', position: { x: 200, y: 0 }, data: { label: 'B', type: 'decision' } },
    ]);

    expect(bridgeLocal.toReactFlowState().nodes.length).toBe(2);
    expect(undoManager.canUndo()).toBe(true);

    // 3. 本地执行 undo：只撤掉 node-a，保留 node-b
    undoManager.undo();
    const afterUndo = bridgeLocal.toReactFlowState();
    expect(afterUndo.nodes.map((n) => n.id)).toEqual(['node-b']);

    // 4. 本地执行 redo：恢复 node-a
    undoManager.redo();
    const afterRedo = bridgeLocal.toReactFlowState();
    expect(afterRedo.nodes.map((n) => n.id).sort()).toEqual(['node-a', 'node-b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/web/tests/undo-manager.test.ts`
Expected: FAIL (Cannot find module `../src/features/collaboration/undo-manager`)

- [ ] **Step 3: Implement CollaborativeUndoManager**

1. 创建 `packages/web/src/features/collaboration/undo-manager.ts`。
2. 内部实例化 `new Y.UndoManager([doc.getMap('nodes'), doc.getMap('edges')], { trackedOrigins: new Set([localClientId]), captureTimeout })`。
3. 监听 `stack-item-added`, `stack-item-popped`, `stack-cleared` 事件并通知订阅者更新 `{ canUndo, canRedo }`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/web/tests/undo-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): add CollaborativeUndoManager scoped to localClientId"
```

---

### Task 7: Zustand `useFlowStore` 全量动作接入 Yjs 与拖拽防抖优化

**Files:**
- Modify: `packages/web/src/stores/flow-store.ts`
- Modify: `packages/web/src/hooks/use-persistence.ts`
- Create: `packages/web/tests/store-yjs-integration.test.ts`

**Interfaces:**
- Consumes: `YjsDiagramBridge` from Task 5, `CollaborativeUndoManager` from Task 6
- Produces:
  - `FlowStoreActions` 新增协同绑定接口：
    - `bindCollaboration(bridge: YjsDiagramBridge, undoManager: CollaborativeUndoManager): () => void`
    - `unbindCollaboration(): void`
    - `diagramTitle: string` / `setDiagramTitle(title: string): void`
  - 既有全部 16 个画布 Action（`addNode`, `addNodes`, `onNodesChange`, `onEdgesChange`, `onConnect`, `deleteSelected`, `updateNodeData`, `updateNodeDimensions`, `batchUpdateNodeData`, `updateEdgeData`, `groupSelectedNodes`, `ungroupNodes`, `alignSelectedNodes`, `distributeSelectedNodes`, `undo`, `redo`）在绑定 `bridge` 后无缝通过 Yjs 事务同步，未绑定时兼容单机内存模式。

- [ ] **Step 1: Write the failing test for Store + Yjs full action integration**

```ts
// packages/web/tests/store-yjs-integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
import { CollaborativeUndoManager } from '../src/features/collaboration/undo-manager';
import { useFlowStore } from '../src/stores/flow-store';

describe('useFlowStore + Yjs integration', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let bridgeA: YjsDiagramBridge;
  let bridgeB: YjsDiagramBridge;
  let undoA: CollaborativeUndoManager;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    docB.on('update', (u: Uint8Array) => Y.applyUpdate(docA, u));

    bridgeA = new YjsDiagramBridge(docA, { localClientId: 'client-a' });
    bridgeB = new YjsDiagramBridge(docB, { localClientId: 'client-b' });
    undoA = new CollaborativeUndoManager(docA, 'client-a', 0);

    useFlowStore.getState().bindCollaboration(bridgeA, undoA);
  });

  it('syncs addNode, groupSelectedNodes, alignSelectedNodes, and undo across Y.Doc', () => {
    const store = useFlowStore.getState();
    store.addNode('process', { x: 30, y: 30 });
    store.addNode('decision', { x: 240, y: 120 });

    const nodes = useFlowStore.getState().nodes;
    expect(nodes.length).toBe(2);
    expect(bridgeB.toReactFlowState().nodes.length).toBe(2);

    // 选中两个节点并执行成组
    useFlowStore.setState({
      nodes: nodes.map((n) => ({ ...n, selected: true })),
      selectedNodeIds: nodes.map((n) => n.id),
    });
    useFlowStore.getState().groupSelectedNodes({ label: '核心分组' });

    const stateB = bridgeB.toReactFlowState();
    expect(stateB.nodes.length).toBe(3); // 1 group + 2 children
    expect(stateB.nodes[0].type).toBe('group');

    // 执行撤销：回退成组操作
    useFlowStore.getState().undo();
    expect(bridgeB.toReactFlowState().nodes.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/web/tests/store-yjs-integration.test.ts`
Expected: FAIL (`bindCollaboration` is not a function)

- [ ] **Step 3: Refactor `flow-store.ts` to delegate mutations to `YjsDiagramBridge`**

1. 在 `flow-store.ts` 内部抽出统一持久化辅助函数 `commitGraphToBridge(nextNodes, nextEdges)`：
   - 当 `activeBridge` 存在时，在单个 `activeBridge.transact()` 中比对并同步 `nodes` 与 `edges` 到 `Y.Doc`，随后调用 `activeUndoManager?.stopCapturing()`。
   - 当 `bridge.subscribe` 收到远端更新时，保留当前本地 `selectedNodeIds` 与正在拖拽节点的瞬态位置，合并更新 Zustand 的 `nodes` 与 `edges`。
2. 针对 `onNodesChange` 的拖拽高频优化：
   - 若 changes 中包含 `type === 'position'` 且 `dragging === true`：只更新 Zustand 本地 `nodes` 状态，不写 `Y.Doc`；
   - 当 `dragging === false`（拖拽放手）或非拖拽离散变更（尺寸调整完、删除）时，提交 `commitGraphToBridge`。
3. 将 `addNode`, `addNodes`, `onEdgesChange`, `onConnect`, `deleteSelected`, `updateNodeData`, `updateNodeDimensions`, `batchUpdateNodeData`, `updateEdgeData`, `groupSelectedNodes`, `ungroupNodes`, `alignSelectedNodes`, `distributeSelectedNodes` 全部接入 `commitGraphToBridge`。
4. `undo` / `redo` 在绑定协同后直接调用 `activeUndoManager.undo()` / `redo()`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/web/tests/store-yjs-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "refactor(web): bind all 16 flow-store actions to YjsDiagramBridge and CollaborativeUndoManager"
```

---

### Task 8: 免登录身份、首次昵称引导与 Awareness 多人光标/选区高亮

**Files:**
- Create: `packages/web/src/features/collaboration/user-identity.ts`
- Create: `packages/web/src/features/collaboration/use-awareness.ts`
- Create: `packages/web/src/features/collaboration/collaboration-provider.tsx`
- Create: `packages/web/src/features/collaboration/collaborative-cursors.tsx`
- Create: `packages/web/src/features/collaboration/collaborator-avatars.tsx`
- Create: `packages/web/src/features/collaboration/nickname-modal.tsx`
- Create: `packages/web/tests/user-identity.test.ts`
- Modify: `packages/web/src/features/canvas/flow-canvas.tsx`
- Modify: `packages/web/src/features/canvas/custom-nodes/base-node-wrapper.tsx`

**Interfaces:**
- Consumes: `UserIdentity`, `AwarenessUserState`, `COLLABORATOR_COLORS` from `@flowstudio/shared`
- Produces:
  - `getOrCreateUserIdentity(): UserIdentity` (首次打开时 `isFirstVisit: true`，保存于 `localStorage['fs-user-identity']`)
  - `saveUserNickname(nickname: string): UserIdentity` (将 `isFirstVisit` 置为 `false`)
  - `worldToViewportPixel(point: { x: number; y: number }, viewport: { x: number; y: number; zoom: number }): { x: number; y: number }`
  - `CollaborationProvider`: 管理 `HocuspocusProvider` 生命周期、连接状态（`'connecting' | 'connected' | 'disconnected'`）、`isSynced` 状态及 `remoteUsers: AwarenessUserState[]`

- [ ] **Step 1: Write the failing test for user identity and coordinate projection**

```ts
// packages/web/tests/user-identity.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrCreateUserIdentity,
  saveUserNickname,
  worldToViewportPixel,
} from '../src/features/collaboration/user-identity';

describe('UserIdentity & Coordinate Projection', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
  });

  it('marks first visit when identity is newly created and clears flag after saving nickname', () => {
    const initial = getOrCreateUserIdentity();
    expect(initial.clientId).toMatch(/^client-/);
    expect(initial.isFirstVisit).toBe(true);
    expect(initial.color).toMatch(/^#[0-9A-F]{6}$/i);

    const updated = saveUserNickname('架构师老张');
    expect(updated.nickname).toBe('架构师老张');
    expect(updated.isFirstVisit).toBe(false);
    expect(getOrCreateUserIdentity().isFirstVisit).toBe(false);
  });

  it('converts flow world coordinates to viewport pixel coordinates accurately', () => {
    const pixel = worldToViewportPixel({ x: 100, y: 200 }, { x: 50, y: -30, zoom: 1.5 });
    expect(pixel).toEqual({ x: 100 * 1.5 + 50, y: 200 * 1.5 - 30 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/web/tests/user-identity.test.ts`
Expected: FAIL (Cannot find module `../src/features/collaboration/user-identity`)

- [ ] **Step 3: Implement UserIdentity, CollaborationProvider, Cursors, Avatars, and Remote Selection**

1. 实现 `packages/web/src/features/collaboration/user-identity.ts`：生成唯一 `clientId`，从 `COLLABORATOR_COLORS` 分配颜色，提供 `worldToViewportPixel` 纯函数。
2. 实现 `use-awareness.ts` 与 `collaboration-provider.tsx`：
   - 连接 `ws://${window.location.host}/collaboration`（支持自定义 URL），房间名为 `diagramId`。
   - 监听 `synced`、`status` 事件；通过 Awareness 广播 `{ clientId, nickname, color, cursor, selectedNodeIds }`（光标广播做 30ms 节流）。
   - 若 `identity.isFirstVisit === true`，自动弹出 `NicknameModal` 引导用户填写昵称。
3. 实现 `collaborative-cursors.tsx`：订阅 React Flow 的 `useViewport()`，将远端用户的画布世界坐标 `cursor` 通过 `worldToViewportPixel` 转换为画布容器像素坐标，渲染平滑过渡的彩色 SVG 光标与昵称胶囊。
4. 修改 `packages/web/src/features/canvas/flow-canvas.tsx`：在 `onMouseMove` 中用 `screenToFlowPosition` 将鼠标坐标转为世界坐标上报 Awareness；在 `onMouseLeave` 中上报 `cursor: null`；挂载 `<CollaborativeCursors />`。
5. 修改 `packages/web/src/features/canvas/custom-nodes/base-node-wrapper.tsx`：当某个节点 ID 出现在远端用户的 `selectedNodeIds` 中时，渲染对应用户 `color` 的 2px 外框与顶部微型昵称标签。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/web/tests/user-identity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): implement user identity, nickname modal, awareness cursors, and remote selection highlight"
```

---

### Task 9: 首页图管理看板（缩略图/新建/重命名/复制/删除/搜索）与 TopBar 协同增强

**Files:**
- Create: `packages/web/src/lib/api-client.ts`
- Create: `packages/web/src/features/dashboard/dashboard-page.tsx`
- Create: `packages/web/src/features/dashboard/diagram-card.tsx`
- Create: `packages/web/src/features/dashboard/create-diagram-modal.tsx`
- Create: `packages/web/tests/api-client.test.ts`
- Modify: `packages/web/src/features/topbar/top-bar.tsx`
- Modify: `packages/web/src/app/app.tsx`

**Interfaces:**
- Consumes: `/api/diagrams` REST API from Task 4, `CollaborationProvider` & `CollaboratorAvatars` from Task 8
- Produces:
  - `apiClient`:
    - `listDiagrams(query?: string): Promise<DiagramSummary[]>`
    - `getDiagram(id: string): Promise<DiagramSummary>`
    - `createDiagram(input: { title: string; description?: string }): Promise<DiagramSummary>`
    - `updateDiagram(id: string, input: { title?: string; description?: string; thumbnail?: string }): Promise<DiagramSummary>`
    - `duplicateDiagram(id: string): Promise<DiagramSummary>`
    - `deleteDiagram(id: string): Promise<void>`
  - `generateMiniSvgThumbnail(nodes: FlowNode[], edges: FlowEdge[]): string` (根据当前节点包围盒生成轻量 SVG 字符串缩略图)
  - Hash 路由：`#/` 渲染 `DashboardPage`，`#/diagram/:id` 渲染包裹在 `CollaborationProvider` 内的画布工作区

- [ ] **Step 1: Write the failing test for `apiClient` and `generateMiniSvgThumbnail`**

```ts
// packages/web/tests/api-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient, generateMiniSvgThumbnail } from '../src/lib/api-client';

describe('apiClient & SVG thumbnail generator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls listDiagrams and duplicateDiagram endpoints properly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ diagrams: [{ id: 'd1', title: '测试图' }] }),
    } as Response);

    const list = await apiClient.listDiagrams('测试');
    expect(fetchSpy).toHaveBeenCalledWith('/api/diagrams?q=%E6%B5%8B%E8%AF%95', undefined);
    expect(list[0].id).toBe('d1');
  });

  it('generates a valid mini SVG thumbnail string from nodes and edges', () => {
    const svg = generateMiniSvgThumbnail(
      [{ id: 'n1', type: 'process', position: { x: 10, y: 20 }, data: { label: 'A', type: 'process' } }],
      [],
    );
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.includes('<rect')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/web/tests/api-client.test.ts`
Expected: FAIL (Cannot find module `../src/lib/api-client`)

- [ ] **Step 3: Implement `apiClient`, `DashboardPage`, `DiagramCard`, and `TopBar` upgrades**

1. 实现 `packages/web/src/lib/api-client.ts`：封装全部 6 个 REST 请求方法与 `generateMiniSvgThumbnail(nodes, edges)`。
2. 实现 `dashboard-page.tsx`、`diagram-card.tsx`、`create-diagram-modal.tsx`：
   - 顶部栏：品牌 Logo、搜索框（实时过滤）、当前用户头像（点击可改昵称）、亮暗主题切换按钮、“+ 新建流程图”主按钮。
   - 卡片网格：展示 `thumbnail` SVG 预览（空图显示精美占位网格）、标题、相对更新时间，以及悬浮操作菜单（重命名、**复制副本**、删除确认）。
3. 升级 `packages/web/src/features/topbar/top-bar.tsx`：
   - 左侧增加“返回图列表”按钮（跳转到 `#/`）。
   - 标题输入框与 `useFlowStore.diagramTitle`（即 `Y.Doc.getMap('meta').get('title')`）双向绑定，失焦时调用 `apiClient.updateDiagram(id, { title })`。
   - 右侧集成：协同连接状态徽标（已同步 / 重连中）、`<CollaboratorAvatars />`（在线协作者头像 + 点击自己头像修改昵称）、**“分享链接”按钮**（复制当前 URL 并显示“已复制局域网协作链接”提示）、导出菜单与主题切换。
4. 在 `use-persistence.ts` 中：当画布节点变更防抖 2000ms 后，自动调用 `generateMiniSvgThumbnail` 并通过 `apiClient.updateDiagram(diagramId, { thumbnail })` 更新缩略图。
5. 修改 `packages/web/src/app/app.tsx`：监听 `window.location.hash`，在 `#/` 与 `#/diagram/:id` 之间切换。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/web/tests/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): add diagram dashboard with duplicate/thumbnail support and upgrade topbar"
```

---

### Task 10: 5 客户端并发协同 + 服务重启恢复 E2E 验证与工程脚本

**Files:**
- Create: `packages/server/tests/e2e-collaboration.test.ts`
- Create: `scripts/dev-all.bat`
- Modify: `packages/web/vite.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildServer` from `packages/server/src/server.ts`, `HocuspocusProvider` from `@hocuspocus/provider`, `YjsDiagramBridge` & `CollaborativeUndoManager`
- Produces:
  - 自动化 E2E 验收测试：验证 **5 个并发客户端同时连接编辑同一张图 + 独立撤销 + 服务端关闭重启后从 SQLite 完整恢复数据**（100% 对应设计文档 §6 M2 验收标准）
  - Vite 开发代理配置（`/api` -> `http://127.0.0.1:3000`, `/collaboration` -> `ws://127.0.0.1:3000`）
  - 根级 `pnpm test`, `pnpm dev:server`, `pnpm dev:all` 与 `scripts/dev-all.bat`

- [ ] **Step 1: Write the E2E 5-client concurrent collaboration & server restart test**

```ts
// packages/server/tests/e2e-collaboration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { buildServer } from '../src/server.js';

describe('M2 Quality Gate: 5 Concurrent Clients & Server Restart Persistence', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-m2-e2e-${Date.now()}.sqlite`);
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(tmpDbPath + suffix)) fs.unlinkSync(tmpDbPath + suffix);
    }
  });

  it('syncs 5 concurrent clients without data loss and survives server restart', async () => {
    // 1. 启动第一代 Server
    const server1 = await buildServer({ dbPath: tmpDbPath });
    await server1.app.listen({ port: 0, host: '127.0.0.1' });
    const addr1 = server1.app.server.address() as { port: number };
    const wsUrl1 = `ws://127.0.0.1:${addr1.port}/collaboration`;

    const createRes = await server1.app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '五人并发压测图' },
    });
    const diagramId = createRes.json().id as string;

    // 2. 同时建立 5 个独立客户端连接
    const clients = Array.from({ length: 5 }, (_, idx) => {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: wsUrl1,
        name: diagramId,
        document: doc,
        WebSocketPolyfill: WebSocket as any,
      });
      return { id: `client-${idx + 1}`, doc, provider };
    });

    await Promise.all(
      clients.map((c) => new Promise<void>((resolve) => c.provider.on('synced', () => resolve()))),
    );

    // 3. 5 个客户端并发写入各自节点
    clients.forEach((c, idx) => {
      c.doc.transact(() => {
        const nodeMap = new Y.Map();
        nodeMap.set('id', `node-${idx + 1}`);
        nodeMap.set('type', 'process');
        nodeMap.set('position', { x: idx * 150, y: 100 });
        nodeMap.set('data', { label: `节点-${idx + 1}`, type: 'process' });
        c.doc.getMap('nodes').set(`node-${idx + 1}`, nodeMap);
      }, c.id);
    });

    // 等待全网收敛与防抖落盘
    await new Promise((r) => setTimeout(r, 800));

    for (const c of clients) {
      expect(c.doc.getMap('nodes').size).toBe(5);
      c.provider.destroy();
    }

    // 4. 关闭第一代 Server（模拟服务重启）
    await server1.app.close();

    // 5. 启动第二代 Server 挂载同一个 SQLite 文件，新客户端连接验证数据完整恢复
    const server2 = await buildServer({ dbPath: tmpDbPath });
    await server2.app.listen({ port: 0, host: '127.0.0.1' });
    const addr2 = server2.app.server.address() as { port: number };

    const recoveryDoc = new Y.Doc();
    const recoveryProvider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${addr2.port}/collaboration`,
      name: diagramId,
      document: recoveryDoc,
      WebSocketPolyfill: WebSocket as any,
    });

    await new Promise<void>((resolve) => recoveryProvider.on('synced', () => resolve()));
    expect(recoveryDoc.getMap('nodes').size).toBe(5);

    recoveryProvider.destroy();
    await server2.app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it runs and check behavior**

Run: `pnpm exec vitest run packages/server/tests/e2e-collaboration.test.ts`
Expected: PASS (or reveals any WebSocket URL / room name parsing gap to fix in Step 3)

- [ ] **Step 3: Configure Vite proxy, root scripts, and `scripts/dev-all.bat`**

1. 修改 `packages/web/vite.config.ts`：增加 `server: { host: '0.0.0.0', port: 5173, proxy: { '/api': 'http://127.0.0.1:3000', '/collaboration': { target: 'ws://127.0.0.1:3000', ws: true } } }`。
2. 修改根目录 `package.json`：增加 `"test": "vitest run"`, `"dev:server": "pnpm -C packages/server dev"`, `"dev:all"` 脚本。
3. 创建 `scripts/dev-all.bat`，支持在 Windows 下一键构建并启动局域网协同服务。

- [ ] **Step 4: Run full test suite & typecheck across all packages**

Run: `pnpm test && pnpm -r build`
Expected: All unit & E2E tests PASS, TypeScript builds with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: complete M2 real-time collaboration, dashboard, and 5-client e2e verification"
```

---

## M2 验收清单（映射设计文档 `2026-11-06-flow-studio-design.md`）

| 设计文档章节与要求 | 对应 Task | 验收方式与标准 |
|---|---|---|
| **§5.1 / §5.2** 单一 Node 进程 + Fastify + Hocuspocus + SQLite | Task 2, 3, 4 | `api.test.ts`、`hocuspocus.test.ts` 通过；单进程同时响应 `/api/diagrams` 与 `/collaboration` WS |
| **§5.3** Yjs 文档结构（`meta` / `nodes` / `edges`）作为唯一事实源 | Task 5, 7 | `yjs-doc-bridge.test.ts`、`store-yjs-integration.test.ts` 通过；全部 16 项 Store 动作经由 Yjs 同步 |
| **§5.7** 局域网实时协作：多人彩色光标、他人选中高亮、断线自动重连 | Task 8 | 多浏览器窗口打开同一图，移动鼠标可见对方平滑光标与昵称胶囊，选中节点可见对方颜色外框 |
| **§5.7** 协同撤销：接入 `Y.UndoManager`，每个人只撤自己的操作 | Task 6, 7 | `undo-manager.test.ts` 通过；A、B 交错编辑时 A 按 `Ctrl+Z` 仅回退 A 的节点修改 |
| **§5.8 / §5.12** 免登录轻量身份：首次打开填写昵称、分配颜色、广播 `clientId` | Task 1, 8 | `user-identity.test.ts` 通过；首次进入弹出昵称设置框，Awareness 包含 `clientId`、`nickname`、`color` |
| **§5.10** 首页图列表：卡片 + 缩略图，支持新建、重命名、删除、**复制**、搜索 | Task 2, 4, 9 | `diagram-repository.test.ts`、`api-client.test.ts` 通过；看板页可搜索、新建、重命名、复制副本、删除图表 |
| **§5.11** 顶部栏：返回列表、文件名同步、在线头像、**分享链接**、导出 | Task 8, 9 | TopBar 显示在线头像组、连接状态徽标、一键复制分享链接按钮，修改标题实时同步多端与看板 |
| **§6 M2 质量关卡** 至少 5 个客户端同时编辑同一张图不丢数据；服务重启后数据完整 | Task 10 | `e2e-collaboration.test.ts` 自动化压测通过（5 客户端并发写入 + Server 销毁重启后 SQLite 100% 恢复） |
