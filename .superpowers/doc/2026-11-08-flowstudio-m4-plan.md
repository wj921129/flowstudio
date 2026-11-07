# FlowStudio M4 实施计划：AI 协作者 (MCP)、批次撤回、版本快照回滚与多格式导出

> **目标**：实现成熟商业级的 AI 人机共治体系（Fastify MCP Streamable HTTP 与 stdio 桥接、服务端 Yjs AI 协作者、7 大标准 MCP 协同工具、AI 批次可撤回与防冲突保护）、版本快照管理与无损差异回滚、前端全格式无损导出（PNG / SVG / JSON）及局域网一键启动脚本。

---

## 阶段任务拆分（Tasks 1 ~ 8 全部完成 ✅）

### Task 1: 服务端快照仓储与自动快照引擎 [x] 已完成
- **改哪里**：`packages/server/src/db/diagram-repository.ts`、`snapshot-repository.ts`、`packages/server/src/routes/snapshots.ts`
- **改什么**：
  - 完善 SQLite `snapshots` 表结构与持久化 API（增删改查快照列表、创建手动快照、AI 批次前自动快照）；
  - 实现快照差异恢复算法（计算快照状态与当前 Y.Doc 差异并写回文档，所有人实时可见且可撤销）；
  - Fastify 提供 `/api/diagrams/:id/snapshots` REST 端点。
- **验收**：编写 `packages/server/tests/snapshots.test.ts` 验证快照创建、列表查询与差异回滚（2 passed）。

### Task 2: 服务端 AI 协作者与 MCP 核心工具体系 [x] 已完成
- **改哪里**：`packages/server/src/mcp/` 模块与 Fastify `/mcp` 路由
- **改什么**：
  - 基于 `@modelcontextprotocol/sdk`（或标准 JSON-RPC 2.0 / Streamable HTTP）实现服务端 MCP 交互协议；
  - 实现 AI 协作者（作为服务端内部 Yjs 客户端挂载到目标图的 Y.Doc，并在 Awareness 广播 `nickname: "AI · FlowBot"`, `color: "#8B5CF6"`）；
  - 实现 7 大标准 MCP 工具：
    1. `list_diagrams`: 列出所有图及访问 URL
    2. `create_diagram`: 新建图并返回 URL
    3. `get_diagram`: 紧凑 JSON 返回当前图全部节点、连线与泳道
    4. `get_selection`: 查询某同事当前选中的节点 ID 与数据
    5. `scaffold_diagram`: 用结构化骨架（泳道+节点+连线）初始化空图并自动排版
    6. `apply_ops`: 原子事务执行批量增量操作（add_node, update_node, delete, connect, disconnect 等）
    7. `auto_layout`: 对图表执行服务端自动排版
- **验收**：编写 `packages/server/tests/mcp-tools.test.ts` 验证所有 7 个 MCP 工具调用与数据一致性（2 passed）。

### Task 3: AI 批次追踪与前端一键撤回机制 [x] 已完成
- **改哪里**：`packages/server/src/collaboration/ai-batch-manager.ts`、`packages/web/src/features/collaboration/`
- **改什么**：
  - 服务端在每次 MCP 修改时，生成唯一 `batchId`，并在 Y.Doc 事务中记录此批次修改的元数据（涉及节点与连线集合）；
  - 画布感知到 AI 正在生成时，显示“AI 正在编辑…”轻量动态气泡；
  - 顶部栏/悬浮操作区显示“AI 修改批次卡片”，包含操作摘要与“撤回此次 AI 修改”按钮；
  - 撤回算法：针对该批次涉及的节点进行逆操作回滚，但若节点已被同事二次修改，则跳过并安全提示。
- **验收**：编写 `packages/server/tests/ai-batch.test.ts` 验证批次记录与安全撤回（3 passed）。

### Task 4: 前端版本历史与快照恢复抽屉面板 [x] 已完成
- **改哪里**：`packages/web/src/features/snapshot/snapshot-drawer.tsx`、`top-bar.tsx`
- **改什么**：
  - 顶部栏增加“历史版本”按钮（带 `History` 图标）；
  - 抽屉面板（Sheet/Drawer）：呈现快照时间线卡片（包含自动快照、手动快照、AI 批次前快照标签，创建时间与缩略描述）；
  - 提供“创建快照”、“预览此版本”、“恢复至此版本（无损）”及“另存为新图”功能。
- **验收**：组件无类型错误，接口联调畅通。

### Task 5: 商业级全格式无损导出（PNG / SVG / JSON） [x] 已完成
- **改哪里**：`packages/web/src/features/topbar/top-bar.tsx`、`packages/web/src/lib/export-utils.ts`
- **改什么**：
  - 基于 `@xyflow/react` 的视口与真实 SVG 元素生成：
    - **PNG 导出**：高分辨率（2x/3x Retina 级），白色/透明背景可切换；
    - **SVG 导出**：纯矢量无损导出，内联必要样式与字体，开箱即用；
    - **JSON 导出与导入**：标准 Schema 校验的 FlowStudio 工程文件，支持一键备份与导入恢复。
- **验收**：编写 `packages/web/tests/export-utils.test.ts` 验证 JSON 导出数据完备性与 SVG 格式有效性（2 passed）。

### Task 6: stdio MCP 客户端轻量桥接脚本 [x] 已完成
- **改哪里**：`scripts/flowstudio-mcp.cjs`
- **改什么**：
  - 编写跨平台的轻量级 stdio 转发脚本，允许同事在 Cursor / Claude Desktop / VSCode 等仅支持 stdio 的客户端中直接通过 `node scripts/flowstudio-mcp.cjs --url http://192.168.x.x:3000/mcp` 与 FlowStudio 连接。
- **验收**：运行测试脚本验证标准输入输出协议握手（`stdio-bridge.test.ts` 1 passed）。

### Task 7: 局域网一键启动脚本与网络绑定 [x] 已完成
- **改哪里**：`scripts/start.bat`、`packages/server/src/index.ts`
- **改什么**：
  - 服务端默认监听 `0.0.0.0:3000`；
  - 启动时自动检索本机全部局域网物理网卡 IPv4 地址（排除 127.0.0.1 及 WSL/虚拟网卡），在终端高亮打印同事可直接访问的链接；
  - `start.bat` 一键并行拉起前后端或运行单进程生产服务。
- **验收**：执行服务启动，终端打印正确的内网访问链接。

### Task 8: M4 综合质量关卡与人机共治全链路验收 [x] 已完成
- **改哪里**：`packages/server/tests/m4-quality-gate.test.ts`
- **改什么**：
  - 端到端测试完整的商业人机共治闭环：
    “Agent 调用 scaffold_diagram 生成泳道骨架 -> 客户端协同连接读取 -> 同事在浏览器中手工修改其中一个节点 -> Agent 调用 apply_ops 增量补充步骤 -> 客户端撤回该 AI 批次验证未冲掉同事的改动 -> 快照恢复还原”。
- **验收**：全量单元与 E2E 测试绿通（20 test files, 39 passed），`pnpm -r build` 成功。
