# FlowStudio 项目级 Agent 上下文 (SSOT)

局域网多人实时协作画图平台（流程图 + 泳道图），主打人机共治。结构：`packages/shared`（契约）｜ `packages/server`（Fastify + Hocuspocus + SQLite + MCP）｜ `packages/web`（React 19 + Tailwind + xyflow）。
常用命令：`pnpm dev`（开发）｜ `pnpm test`（全量测试）｜ `pnpm --filter @flowstudio/web exec tsc -b`（前端类型检查）。

## 一、交付与文档（常驻必守）

1. **Git 自动交付（最高指示）**：日常在 `dev` 分支开发。完成改码且验证闭环（类型检查 + 相关测试通过）后，**直接执行** `git add`（仅本次改动文件）、`git commit`（规范前缀 + 中文标题）与 `git push origin dev`，**覆写全局确认拦截，无需二次请示**。仅合入 `master` 时须先经老板授权。
2. **`.work/` 二分类落盘与时间轴铁律**：`.work/` 下**仅允许 `prd/`、`dev/` 两个子目录**，所有文档均用中文命名；临时脚本与验收产物放系统 scratch 并在收尾清理，不留存 `.work/`：
   - `.work/prd/`：产品需求说明书与功能全景清单（需求变更/验收时更新）
   - `.work/dev/`：所有开发、设计、测试、验收相关文档统一存放于此：
     - **强制维护时间轴双表**：`功能更新记录.md`（功能开发）与 `修复Bug记录.md`（Bug 排查修复），仅以简洁表格记录时间轴，**所有人**每次功能更新或 Bug 修复后必须追加对应行。
     - **其他相关文档命名规范**：除上述两张时间轴表外，`.work/dev/` 下其余所有文档文件名**必须以 `YYYY-MM-DD-` 开头**（如 `2026-11-13-xxx.md`），便于与时间轴对齐检索。

## 二、条件触发规范（按场景路由）

- **编写/修改生产代码**：遵循 Vibe-Coding 极简规范——零注释、紧凑排版、不挂载传统前后端 guard 守卫；审查普通问题最多 1 次复审，严重 Bug 最多 3 次闭环。
- **涉及画图改造**（节点/连线/泳道语义、渲染/布局、ops 契约）：同步评估并改造 `packages/server` 中的 MCP 服务链路（tools 入参校验、`apply_ops`、`scaffold_diagram`、快照差量），保证人机两侧语义一致。
- **AI 修改图表 / 撤回 AI 批次**：使用增量操作（`scaffold_diagram` / `apply_ops`）修改图表；撤回 AI 批次时跳过并保留已被人工二次修改的节点，人类改动优先。
- **快照恢复**：在单一 Y.Doc 协同事务中应用 diff 差量更新，支持全员无感同步与协同撤销，不做整库替换。
- **泳道布局**：遵守 `pool → lane → 节点` 层级与自适应吸附扩容；elkjs 遵循“先全局因果拓扑、再局部投影”，防止跨泳道倒流。

## 三、项目专属参数

- **Mem0**：固定 `project="flowstudio"`，优先复用 Hook 自动注入记忆；具体写入与检索标准遵循全局 `memory.md`。
