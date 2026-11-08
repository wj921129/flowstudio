# FlowStudio 项目级 Agent 上下文

> **文件定位**：FlowStudio 项目级 Agent 上下文唯一真相源（供 Claude / Cursor / Gemini / Codex / Qoder 等共享）。
> **项目定位**：局域网多人实时协作画图平台（流程图 + 泳道图），主打**人机共治（Human-AI Co-Governance）**。
> **详细文档**：环境搭建、开发命令与 MCP 客户端接入请参阅 [README.md](file:///e:/workspace/my-workspace/flowstudio/README.md)。

---

## 一、项目架构与模块职责

本项目采用 `pnpm workspace` 现代化 Monorepo 架构，全栈 TypeScript 开发：

```text
flowstudio/
├── packages/
│   ├── shared/                 # 共享层：数据契约、Zod Schema 校验与跨端公共工具
│   ├── server/                 # 服务端：Fastify 5 + Hocuspocus CRDT + SQLite + MCP (7大工具)
│   └── web/                    # 前端：React 19 + Vite + Tailwind CSS + @xyflow/react
├── data/                       # 运行时持久化数据目录（SQLite 数据库与 WAL）
├── scripts/                    # 运维与接入脚本（start.bat, flowstudio-mcp.cjs）
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

### 5. 记忆协同与原子沉淀 (Mem0 Co-Governance)
- **记忆先行 (Pre-check Mandatory)**：排查、设计、改码前优先利用 `PreInvocation` Hook 自动检索注入的记忆；仅当 Hook 未注入、需深挖特定业务细节或写入前防重时才显式调用 `mem0_search`，命中高相关事实核实有效性；
- **作用域隔离**：本项目在 Mem0 体系中固化唯一标识 `project="flowstudio"`，严禁省略或混入公共池；
- **权威与截断**：服务端实施 `score > 0.55` 硬物理截断；`[人工权威]` 为老板钦定铁律必须严格遵从，`[系统沉淀]` 作为参考证据；
- **单句原子化**：沉淀事实单句全中文表达（≤ 100 字），严格落实“四不录入”（严禁虚假推测、临时状态、静态公理、大段原始流水）。

### 6. Git 分支管理与自动化交付流水线 (Git Branching & Auto-Sync)
- **dev 分支日常开发**：日常功能开发、改码与问题排查均在 `dev` 分支进行；
- **修改即自动 Commit & Push（全自动交付）**：每次修改完代码后，必须自动执行 `git commit` 与 `git push origin dev`，确保 `dev` 环境时刻保持最新状态。提交信息严格遵循 Conventional Commits 规范（如 `feat:`、`fix:`、`refactor:`、`docs:` 等），且 **Title 必须使用中文简述当次修改内容**（示例：`feat: 支持泳道拖拽自适应撑开`、`fix: 修复节点撤回冲突判定`）；
- **重大里程碑主干合并建议**：当产生**大功能新增**、**重大架构改造**或**影响重大的核心 Bug 修复**时，严禁直接或静默合并 master，必须主动向老板提出合入 `master` 分支的建议与发布风险提示，待老板明确授权后再行执行合并操作。
