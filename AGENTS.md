# FlowStudio 项目规则与架构指引

> **文件定位**：FlowStudio 项目级 Agent 上下文唯一真相源（供 Claude / Cursor / Gemini / Codex / Qoder 等共享）。
> **项目定位**：局域网多人实时协作画图平台（流程图 + 泳道图），主打**人机共治（Human-AI Co-Governance）**。

---

## 一、项目架构与模块职责

本项目采用 `pnpm workspace` 现代化 Monorepo 架构，全栈 TypeScript 开发：

```text
flowstudio/
├── packages/
│   ├── shared/                 # 共享层：数据契约、Zod Schema 校验与跨端公共工具
│   │   ├── src/schemas/        # 节点、连线、泳道、快照、MCP 操作的统一 Zod 定义
│   │   └── tests/              # 共享层 Schema 严格单测
│   │
│   ├── server/                 # 服务端：Fastify 5 + Hocuspocus CRDT + SQLite + MCP
│   │   ├── src/db/             # SQLite 仓储（better-sqlite3，含快照存储与无损回滚算法）
│   │   ├── src/collaboration/  # Hocuspocus WebSocket 协同、AI 批次防冲突账本 (AiBatchManager)
│   │   ├── src/mcp/            # Fastify /mcp 端点（JSON-RPC 2.0 / Streamable HTTP）及 7 大 MCP 工具
│   │   ├── src/routes/         # REST API 路由（图表 CRUD、快照时间线、导出接口）
│   │   └── tests/              # 服务端单元测试与 5 客户端并发协作 / M4 人机共治 E2E 测试
│   │
│   └── web/                    # 前端：React 19 + Vite + Tailwind CSS + @xyflow/react
│       ├── src/features/
│       │   ├── canvas/         # React Flow 画布、9 种基础节点、毛玻璃 Pool/Lane 泳道、Waypoint 折点连线
│       │   ├── collaboration/  # YjsDocBridge 双向数据绑定、多人光标/头像/选中高亮、AI 批次悬浮卡片
│       │   ├── layout/         # elkjs 泳道感知自动排版引擎、泳道自动扩容与吸附计算
│       │   ├── snapshot/       # 快照抽屉面板（时间线卡片、无损恢复、另存为新图）
│       │   ├── shape-palette/  # 左侧图形库拖拽面板（含基础形状与泳道模板分组）
│       │   └── topbar/         # 顶部操作栏（图名称内联编辑、排版、导出、主题切换）
│       └── tests/              # 前端组件与算法测试套件
│
├── scripts/
│   ├── start.bat               # Windows 局域网一键启动脚本（锁定项目根目录、防乱码、自动唤起浏览器）
│   └── flowstudio-mcp.cjs      # 跨平台轻量 stdio MCP 转发桥接脚本（对接 Cursor / Claude Desktop）
│
├── start.bat                   # 根目录便捷启动入口
└── .superpowers/doc/           # 需求设计文档与实施规划归档目录
```

---

## 二、核心设计哲学与红线约束

### 1. 人机共治金科玉律（Human-AI Co-Governance）
- **AI 增量协同，禁止暴力覆盖**：AI 通过 MCP 修改图表时，必须使用结构化增量操作（`scaffold_diagram` / `apply_ops`），严禁未读取直接全图抹除；
- **批次追踪与防冲突撤回（Safe Conflict Rollback）**：服务端记录每次 AI 调用的 `batchId` 及修改节点集。画布提供“撤回此次 AI 修改”；
- **人类改动最高优先**：若 AI 批次涉及的节点/连线已被同事手工二次修改，撤回时**必须跳过并安全保留同事成果**，严禁冲掉人类工作。

### 2. 无损差异快照引擎（Lossless Delta Rollback）
- **严禁直接替换 Y.Doc**：恢复快照时，服务端计算目标快照与当前 Y.Doc 的差量，在单一协同事务中应用修改与删除；
- **全员无感平滑更新**：所有在线客户端保持 WebSocket 连接不断连，实时看到差量更新，且该恢复动作本身支持协同撤销。

### 3. 泳道系统规范
- **嵌套结构**：严格遵守 `pool → lane → 节点` 层级，节点不能跨 pool，连线可跨 pool 和 lane；
- **自适应与扩容**：节点在泳道内拖拽时自动吸附归属；沿主轴拖出边界时，泳道和池自动平滑撑开尺寸；
- **复合排版引擎**：使用 `elkjs` 时先依据拓扑关系计算全局因果流向顺序，再投影至各泳道局部坐标系，杜绝跨泳道倒流重叠。

### 4. 禁用无关守卫
- 本项目为现代 React 19 + TypeScript + Fastify 全栈应用；
- **严禁挂载**针对传统 jQuery / JSP / Thymeleaf 的旧时代前端或后端规范守卫；
- 遵循现代函数式 React、Tailwind CSS 设计令牌与 TypeScript 严格类型范式。

---

## 三、常用命令速查

| 操作 | 命令 | 说明 |
|---|---|---|
| **局域网一键启动** | `start.bat` 或 `scripts\start.bat` | 编译检查、拉起服务端单进程并延时自动打开浏览器 |
| **全量自动化测试** | `pnpm test` | 运行所有 20 个测试套件（含 39 个单元与 E2E 协同测试） |
| **Monorepo 构建** | `pnpm -r build` | 全局 TypeScript 编译打包（0 报错验证） |
| **开发环境运行** | `pnpm dev` | 并行拉起前端 Vite 热更新与后端开发服务 |

---

## 四、外部 Agent（Cursor / Claude Desktop）接入 MCP

在 IDE 的 MCP 配置文件中添加如下配置，即可通过 stdio 桥接与本地 FlowStudio 建立实时人机共治：

```json
{
  "mcpServers": {
    "flowstudio": {
      "command": "node",
      "args": [
        "E:/workspace/my-workspace/flowstudio/scripts/flowstudio-mcp.cjs",
        "--url",
        "http://127.0.0.1:3000/mcp"
      ]
    }
  }
}
```

支持的标准 MCP 工具：
1. `list_diagrams`：列出所有图及访问直连 URL
2. `create_diagram`：新建图并返回 URL
3. `get_diagram`：返回当前图全部节点、连线与泳道结构
4. `get_selection`：获取指定或全体同事选中的节点 ID 与数据
5. `scaffold_diagram`：依据结构化文本一次性生成泳道与流程图骨架
6. `apply_ops`：原子事务级执行批量增量操作（`add_node`, `update_node`, `delete`, `connect` 等）
7. `auto_layout`：触发服务端智能分层排版

---

## 五、改码与协同规则

1. **改码许可（四要素闭环）**：改文件前须同时明确且具备：改哪里、改什么、影响面、如何验收。缺一不可，禁止未核准随意改码。
2. **临时产物**：调试/诊断用的一次性脚本、临时文件：用完即删，严禁入库。
3. **文档归档**：所有需求、设计、计划文档归档于 `.superpowers/doc/`。
4. **测试前置与验证**：功能落地后必须运行 `pnpm test` 验证回归通过。
