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
6. **Git 交付流水线（最高指示）**：日常开发在 `dev` 分支；完成改码与验证闭环（类型检查 + 相关测试通过）后，**直接执行** `git add`（仅本次任务改动文件）、`git commit`（规范格式+中文 Title）与 `git push origin dev`，**覆写全局授权询问，无需向老板二次确认**；重大变更合入 `master` 前主动建议并经老板授权。
7. **画图改造联动 MCP**：涉及画图改造（渲染/布局/节点/连线/泳道语义、ops 契约等）时，必须评估对 MCP 服务的影响并同步改造（tools 入参/校验、`apply_ops`、`scaffold_diagram`、快照差量等链路），保证人机两侧语义一致，严禁只改单侧留下断层。
8. **文档维护与三分类规范**：`.work/` 下**仅允许 `prd/`、`flow/`、`tech/` 三个子目录**，所有文档必须按职责归入对应目录（中文命名），**严禁将任何文档、脚本或临时产物直接放在 `.work/` 下或新建三分类之外的目录**（临时验收产物须放系统 scratch 并在收尾清理）：
   - `.work/prd/`：需求说明书与功能全景清单（需求变更与功能验收时更新）；
   - `.work/tech/`：系统架构、核心技术方案与设计文档（架构改造与设计定案时更新）；
   - `.work/flow/`：里程碑实施流程、研发测试流转与交付总结（阶段推进时记录并及时合并）。
