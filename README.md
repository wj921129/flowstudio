# FlowStudio

> 局域网多人实时协作画图平台（流程图 + 泳道图），主打**人机共治（Human-AI Co-Governance）**。

FlowStudio 专为局域网团队设计，结合现代 Web 技术与分布式 CRDT 协同算法，支持人类团队与外部 AI Agent（Claude / Cursor / IDE 插件）在同一画布上无缝协作、安全共治。

---

## ✨ 核心功能与特性

- 👥 **多人实时协同**：基于 Yjs CRDT + Hocuspocus WebSocket，支持多人同时编辑、光标移动、头像气泡与实时选中高亮。
- 🎨 **丰富图形与泳道**：支持 9 种基础流程节点（矩形、圆角、判定、圆形、菱形、圆柱体等）、毛玻璃 Pool/Lane 泳道、Waypoint 多折点智能连线。
- 🤖 **AI 人机共治**：通过 Fastify MCP 端点提供 14 大标准 MCP 画布操作工具；画布具备 AI 批次悬浮卡片与防冲突撤回（保留人类同事手工修改，安全撤回 AI 操作）。
- 📸 **无损差异快照引擎**：恢复历史快照时全员 WebSocket 连接不断连，通过单一协同事务平滑应用差量，并支持快照另存为新图。
- 📐 **泳道感知自动排版**：集成 `elkjs` 分层排版引擎，先拓扑计算因果流向再投影至局部泳道，杜绝跨泳道倒流重叠。
- 🚀 **局域网一键开箱即用**：自动探测局域网 IP，单进程拉起 Web 静态资源托管与后端协同服务，自动唤起浏览器。

---

## 🏗 项目架构与模块职责

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
│   │   ├── src/mcp/            # Fastify /mcp 端点（JSON-RPC 2.0 / Streamable HTTP）及 14 大 MCP 工具
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
├── data/                       # 运行时持久化数据目录（SQLite 数据库与 WAL，已 gitignore）
├── scripts/                    # 运维与验收脚本（start.bat, dev-all.bat, stop.bat, render-acceptance-svg.mjs）
├── mcp/                        # MCP stdio 桥接脚本（flowstudio-mcp.cjs，对接 Cursor / Claude Desktop）
└── .work/                      # 项目标准文档中心（文件夹英文简称，文档中文）
    ├── prd/                    # 产品需求规格说明书与已实现功能全景清单
    └── dev/                    # 开发与测试文档（含强制维护的功能更新/修复Bug时间轴及 YYYY-MM-DD- 专题文档）
```

---

## 🚀 快速开始

### 环境要求
- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0

### 1. 安装依赖与编译
```bash
# 安装依赖
pnpm install

# Monorepo 全局编译
pnpm build
```

### 2. 生产单进程启动（推荐）
直接运行 `scripts/start.bat` 或执行 npm 脚本：
```bash
# 方式一：运行标准启动脚本（自动构建、环境检查、检测端口并自动打开浏览器）
scripts\start.bat

# 方式二：通过 pnpm 启动
pnpm start
```
启动成功后，控制台将输出本机直连与局域网访问地址（如 `http://192.168.x.x:3000`），局域网内其他设备直接通过浏览器访问即可实时协同画图。

### 3. 开发模式
```bash
# 单独启动前端 Vite 热更新（默认端口 5173）
pnpm dev

# 或一键启动前后端双窗口开发模式
scripts\dev-all.bat
```

---

## 🧪 自动化测试

项目具备高覆盖率的自动化测试套件，涵盖共享 Schema、服务端 REST API、Hocuspocus 协同同步、5 客户端并发协作以及 M4 人机共治端到端测试：

```bash
# 运行全部 29 个测试套件（85 个测试用例）
pnpm test
```

---

## 🤖 外部 AI 工具接入（MCP Server）

FlowStudio 内置 Fastify 原生 MCP 服务（端点 `/mcp`，遵循 Model Context Protocol 标准），并提供了轻量级的跨平台 stdio 转发桥接脚本 [`mcp/flowstudio-mcp.cjs`](file:///C:/workspace/my-workspace/flowstudio/mcp/flowstudio-mcp.cjs)。

### 在 Cursor / Claude Desktop 中配置

在 IDE 的 MCP 配置文件（如 Cursor 的 `~/.cursor/mcp.json` 或 Claude Desktop 的配置）中添加：

```json
{
  "mcpServers": {
    "flowstudio": {
      "command": "node",
      "args": [
        "C:/workspace/my-workspace/flowstudio/mcp/flowstudio-mcp.cjs",
        "--url",
        "http://127.0.0.1:3000/mcp"
      ]
    }
  }
}
```

### 14 大标准 MCP 协作工具

| 工具名称 | 功能描述 |
|---|---|
| `list_diagrams` | 列出系统中所有图表及其直连 URL 与更新时间 |
| `create_diagram` | 新建空白图表并返回访问直连 URL |
| `rename_diagram` | 重命名指定图表标题并同步至在线协同客户端 |
| `delete_diagram` | 删除指定图表及其持久化数据 |
| `get_diagram` | 获取指定图表的全部节点、连线与泳道结构数据 |
| `search_nodes` | 按关键词、泳道或节点类型局部检索节点及直接关联连线 |
| `get_selection` | 获取指定客户端或全体在线同事当前选中的节点 ID 与数据 |
| `list_templates` | 列出 8 个范式预设（含完整 DiagramSpec 语义结构），供修改后快速出图 |
| `scaffold_diagram` | 依据 DiagramSpec 语义规范生成或重渲染图表（含语义软体检 `warnings`） |
| `apply_ops` | 原子事务级执行批量增量操作（含语义软体检 `warnings` 与锚定锁保护） |
| `auto_layout` | 触发服务端的智能分层拓扑与泳道自动排版 |
| `undo_ai_batch` | 撤回指定或最近一条活跃 AI 批次（字段级防冲突保留人类同事修改） |
| `list_snapshots` | 列出指定图表的历史备份快照（含触发类型与时间戳） |
| `restore_snapshot` | 无损恢复指定历史快照（单一 Y.Doc 协同事务差量更新，全员在线无感同步） |

---

## 📦 核心技术栈

- **Frontend**：React 19, [@xyflow/react](https://reactflow.dev/) (React Flow), Vite, Tailwind CSS v4, Zustand, Lucide React
- **Backend**：Fastify 5, [@hocuspocus/server](https://tiptap.dev/docs/hocuspocus), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), Yjs, [elkjs](https://github.com/kieler/elkjs)
- **Shared & Tooling**：TypeScript 5.7, Vitest 5, Zod 4, pnpm workspaces

---

## 📄 规则与规范

- 面向 AI Agent 的规范与红线守则请参阅 [AGENTS.md](file:///e:/workspace/my-workspace/flowstudio/AGENTS.md)。
