# FlowStudio 项目级 Agent 上下文 (SSOT)

> 局域网多人实时协作画图平台（流程图+泳道图），主打人机共治。详见 [README.md](file:///e:/workspace/my-workspace/flowstudio/README.md)。

## 一、架构与常用命令
- **架构**：Monorepo（`packages/shared` 共享契约 ｜ `packages/server` Fastify+Hocuspocus+SQLite+MCP ｜ `packages/web` React 19+Tailwind+xyflow）。
- **命令**：开发 `pnpm dev` ｜ 测试 `pnpm test` ｜ 依赖 `pnpm install` ｜ 脚本 `scripts/start.bat`。

## 二、人机共治与工程红线
1. **增量协同与人类优先**：MCP 修改图表必用增量操作（`scaffold_diagram`/`apply_ops`），严禁全图覆盖；撤回 AI 批次时若节点已被人工二次修改必须跳过并安全保留，人类改动最高优先。
2. **无损差量快照**：快照恢复严禁整库替换 Y.Doc，必须在单一协同事务中应用 diff 差量，全员无感更新并支持协同撤销。
3. **泳道系统规范**：严格遵守 `pool → lane → 节点` 层级，自适应吸附扩容；elkjs 先全局因果拓扑再局部投影，防跨泳道倒流。
4. **Vibe-Coding 极简规范**：零注释且紧凑排版；严禁挂载传统前端/后端 guard 守卫；审查普通问题最多 1 次复审，严重 Bug 最多 3 次闭环。
5. **Mem0 记忆规范**：优先 Hook 自动注入；固定 `project="flowstudio"`；score > 0.55；单句中文 ≤ 100 字且严格执行四不录入。
6. **Git 交付流水线**：日常开发在 `dev` 分支；改码后自动 `git commit`（规范格式+中文 Title）并 `git push origin dev`；重大变更主动建议合入 master 并经老板授权。
