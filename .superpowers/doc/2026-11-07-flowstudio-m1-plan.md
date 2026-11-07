# FlowStudio M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the FlowStudio monorepo scaffold, React Flow canvas, 9 flow-chart node types, orthogonal edges, property panel, toolbar, dark/light theme, and localStorage persistence — all without a server, ready for M2 to layer collaboration onto.

**Architecture:** pnpm workspace monorepo with three packages: `web` (Vite + React 19 + Tailwind v4 + shadcn/ui + @xyflow/react), `server` (Fastify + Hocuspocus + better-sqlite3, stub in M1), `shared` (TypeScript types + node registry + zod schemas). M1 delivers a fully functional single-user flow-chart editor running in `pnpm dev` from `packages/web`.

**Tech Stack:** pnpm 9, TypeScript 5.6, Vite 6, React 19, @xyflow/react 12, Tailwind CSS v4, shadcn/ui, Zustand, lucide-react, zod

**Spec:** `doc/2026-11-06-flow-studio-design.md` (§5.1–§5.4, §5.6, §5.11, §5.12) & `.superpowers/doc/2026-11-07-flowstudio-canvas-modular-elements-and-interaction-spec.md`

## Global Constraints

- Node.js ≥ 22, pnpm ≥ 9
- TypeScript strict mode throughout
- Zero CDN dependencies — all assets bundled
- All UI text hardcode Chinese for first phase; i18n deferred
- CSS colors MUST go through design tokens (CSS custom properties); no hardcoded hex in components
- File naming: kebab-case for files, PascalCase for React components
- Target browsers: Chrome 120+ (LAN use, no IE/Safari concern)

## Review Focus

1. **Dark/light theme switch with no leaked colors** — every surface, border, shadow, and text must respond to theme toggle. Test: toggle theme on every page and screenshot; zero raw hex in component files.
2. **Node type registry extensibility** — adding a new node type must require only adding one entry to the registry and one React component, not touching canvas/toolbar/sidebar. Test: add a dummy "Test" node type and verify it appears in palette and renders on canvas without changing any other file.
3. **Canvas performance with 200 nodes** — React Flow should not jank when rendering 200 nodes with edges. Test: programmatically add 200 nodes, pan/zoom, measure FPS.
4. **localStorage data integrity on refresh** — save → refresh → load must round-trip all node types, positions, edge connections, styles. Test: create a complex diagram, refresh, verify JSON equality.
5. **Zustand↔ReactFlow sync correctness** — deleting a node must also delete its edges; undo (local, non-Yjs) should restore both. Test: add node, connect, delete node, undo, verify edges restored.
6. **Group & Ungroup coordinate integrity** — forming a group (Ctrl+G) and un-grouping (Ctrl+Shift+G) must preserve absolute canvas positions with zero visual jumps or edge detachments. Test: select 3 nodes, Ctrl+G, drag group, Ctrl+Shift+G, verify node and edge world positions.

---

## File Structure

```
flowstudio/
├── packages/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── main.tsx                  # React entry
│   │   │   │   ├── app.tsx                   # Router + providers
│   │   │   │   └── providers.tsx             # ThemeProvider + ReactFlowProvider
│   │   │   ├── components/ui/               # shadcn/ui components (auto-generated)
│   │   │   ├── features/
│   │   │   │   ├── canvas/
│   │   │   │   │   ├── flow-canvas.tsx       # ReactFlow wrapper (snapToGrid, marquee selection)
│   │   │   │   │   ├── custom-nodes/         # 9 node type components + BaseNodeWrapper
│   │   │   │   │   │   ├── base-node-wrapper.tsx # Base container (Handles, selection, inline edit)
│   │   │   │   │   │   ├── start-end-node.tsx
│   │   │   │   │   │   ├── process-node.tsx
│   │   │   │   │   │   ├── decision-node.tsx
│   │   │   │   │   │   ├── io-node.tsx
│   │   │   │   │   │   ├── document-node.tsx
│   │   │   │   │   │   ├── subprocess-node.tsx
│   │   │   │   │   │   ├── database-node.tsx
│   │   │   │   │   │   ├── comment-node.tsx
│   │   │   │   │   │   ├── group-node.tsx    # Hybrid group node (logical group vs container frame)
│   │   │   │   │   │   └── index.ts          # nodeTypes map export
│   │   │   │   │   ├── custom-edges/
│   │   │   │   │   │   ├── orthogonal-edge.tsx
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   ├── floating-toolbar/
│   │   │   │   │   │   └── contextual-action-bar.tsx # Contextual action bar for multi-selection & groups
│   │   │   │   │   ├── utils/
│   │   │   │   │   │   └── group-calculator.ts   # Bounding box & coordinate converter
│   │   │   │   │   └── canvas-controls.tsx   # zoom/minimap overlay
│   │   │   │   ├── toolbar/
│   │   │   │   │   ├── floating-toolbar.tsx  # bottom floating bar
│   │   │   │   │   └── toolbar-button.tsx
│   │   │   │   ├── sidebar/
│   │   │   │   │   ├── shape-palette.tsx     # left panel, drag-to-add
│   │   │   │   │   └── property-panel.tsx    # right panel, edit selected
│   │   │   │   └── theme/
│   │   │   │       ├── theme-provider.tsx
│   │   │   │       ├── theme-toggle.tsx
│   │   │   │       └── tokens.css            # design tokens
│   │   │   ├── hooks/
│   │   │   │   ├── use-flow-store.ts         # Zustand store hook
│   │   │   │   └── use-persistence.ts        # localStorage save/load
│   │   │   ├── stores/
│   │   │   │   └── flow-store.ts             # Zustand store definition
│   │   │   └── lib/
│   │   │       ├── node-utils.ts             # node factory, ID generation
│   │   │       └── storage.ts                # localStorage wrapper
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── server/                               # Stub in M1
│   │   ├── src/
│   │   │   └── index.ts                      # placeholder
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── shared/
│       ├── src/
│       │   ├── types.ts                      # Node/Edge/Lane type definitions
│       │   ├── node-registry.ts              # node type registry
│       │   ├── constants.ts                  # shared constants
│       │   └── index.ts                      # barrel export
│       ├── tsconfig.json
│       └── package.json
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .gitignore
└── README.md
```

---

### Task 1: Monorepo Scaffold + Dev Tooling

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `README.md`
- Create: `packages/web/package.json`, `packages/web/vite.config.ts`, `packages/web/tsconfig.json`, `packages/web/index.html`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/index.ts`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: working `pnpm dev` in `packages/web` that shows a blank React page; `packages/shared` importable from `packages/web`

- [x] **Step 1: Create root monorepo config**

  `pnpm-workspace.yaml` with `packages: ['packages/*']`. Root `package.json` with `"private": true`, scripts `"dev": "pnpm -C packages/web dev"`, `"build": "pnpm -r build"`. `tsconfig.base.json` with strict mode, ES2022 target, paths for `@flowstudio/shared`. `.gitignore` for `node_modules`, `dist`, `.turbo`.

- [x] **Step 2: Create `packages/shared` package**

  `package.json` name `@flowstudio/shared`, main `dist/index.js`, types `dist/index.d.ts`, build script `tsc`. `tsconfig.json` extending base. `src/index.ts` exporting a placeholder `export const VERSION = '0.1.0'`.

- [x] **Step 3: Create `packages/server` stub**

  `package.json` name `@flowstudio/server`, `src/index.ts` with `console.log('FlowStudio server — M2')`.

- [x] **Step 4: Create `packages/web` with Vite + React 19 + TypeScript**

  `package.json` with dependencies: `react`, `react-dom`, `@xyflow/react`, `zustand`, `lucide-react`, `@flowstudio/shared` as `workspace:*`. Dev deps: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`. `vite.config.ts` with react plugin. `index.html` with `<div id="root">`. `src/app/main.tsx` rendering `<App />`.

- [x] **Step 5: Install all dependencies**

  Run: `pnpm install` from root.

- [x] **Step 6: Verify dev server starts**

  Run: `pnpm dev`
  Expected: Vite dev server starts, browser shows blank React page, no errors in console.

- [x] **Step 7: Verify shared package import**

  In `main.tsx`, `import { VERSION } from '@flowstudio/shared'` and `console.log(VERSION)`. Verify `0.1.0` in console.

- [x] **Step 8: Initialize git repo**

  ```bash
  cd flowstudio && git init && git add -A && git commit -m "chore: scaffold monorepo"
  ```

---

### Task 2: Design Tokens + Theme System

**Files:**
- Create: `packages/web/src/features/theme/tokens.css`
- Create: `packages/web/src/features/theme/theme-provider.tsx`
- Create: `packages/web/src/features/theme/theme-toggle.tsx`
- Create: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/app.tsx`
- Modify: `packages/web/tailwind.config.ts`

**Interfaces:**
- Consumes: Task 1 scaffold
- Produces: `ThemeProvider` context with `theme: 'light' | 'dark'` and `toggleTheme()`; CSS custom properties `--fs-bg`, `--fs-surface`, `--fs-border`, `--fs-text`, `--fs-text-muted`, `--fs-primary`, `--fs-accent`, `--fs-shadow` (plus more) available globally; `ThemeToggle` button component.

- [x] **Step 1: Define design tokens in `tokens.css`**

  Two sets of CSS custom properties under `:root` (light) and `:root.dark` (dark). Colors inspired by Figma/Linear: large white/dark surfaces, subtle borders, accent blue. Include canvas-specific tokens: `--fs-canvas-bg`, `--fs-canvas-dot` (grid dot color), `--fs-node-bg`, `--fs-node-border`, `--fs-node-text`, `--fs-edge-stroke`, `--fs-selection-ring`.

- [x] **Step 2: Wire Tailwind to design tokens**

  In `tailwind.config.ts`, extend `colors` to reference CSS variables: `bg: 'var(--fs-bg)'`, `surface: 'var(--fs-surface)'`, etc. This allows `className="bg-surface text-fs-text"` everywhere.

- [x] **Step 3: Implement `ThemeProvider` + `ThemeToggle`**

  `ThemeProvider`: React context, reads `localStorage('fs-theme')`, adds/removes `dark` class on `<html>`. `ThemeToggle`: `<Sun />`/`<Moon />` icon button from lucide-react.

- [x] **Step 4: Set up `providers.tsx` and update `app.tsx`**

  `providers.tsx` wraps children in `ThemeProvider` + `ReactFlowProvider`. `app.tsx` renders `<Providers><EditorPage /></Providers>` (EditorPage placeholder for now).

- [x] **Step 5: Verify theme toggle**

  Toggle dark/light, inspect `<html>` class, verify all CSS variables change. No hardcoded hex in any component.

- [x] **Step 6: Commit**

  ```bash
  git add -A && git commit -m "feat: design tokens + dark/light theme system"
  ```

---

### Task 3: Shared Types + Node Registry

**Files:**
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/node-registry.ts`
- Create: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `FlowNodeType` enum: `StartEnd`, `Process`, `Decision`, `IO`, `Document`, `SubProcess`, `Database`, `Comment`, `Group`
  - `FlowNodeData` type: `{ label: string; type: FlowNodeType; style?: NodeStyleData }`
  - `FlowEdgeData` type: `{ label?: string; style?: EdgeStyleData }`
  - `NodeRegistryEntry`: `{ type: FlowNodeType; label: string; icon: string; defaultSize: { width: number; height: number }; handles: HandlePosition[]; mcpDescription: string }`
  - `NODE_REGISTRY: Map<FlowNodeType, NodeRegistryEntry>` — the single source for all node metadata
  - `NodeStyleData`: `{ fillColor?: string; borderColor?: string; borderWidth?: number; borderStyle?: 'solid' | 'dashed'; fontSize?: number; fontColor?: string }`
  - `EdgeStyleData`: `{ strokeColor?: string; strokeWidth?: number; strokeStyle?: 'solid' | 'dashed'; animated?: boolean }`

- [x] **Step 1: Define types in `types.ts`**

  All types listed above plus `FlowDiagram`: `{ id: string; title: string; nodes: FlowNode[]; edges: FlowEdge[]; createdAt: string; updatedAt: string }`. `FlowNode` and `FlowEdge` extend `@xyflow/react`'s `Node<FlowNodeData>` and `Edge<FlowEdgeData>`.

- [x] **Step 2: Build node registry in `node-registry.ts`**

  Export `NODE_REGISTRY` as a `Map<FlowNodeType, NodeRegistryEntry>` with 9 entries. Default sizes: StartEnd 120×60, Process 160×80, Decision 140×100, IO 160×80, Document 160×80, SubProcess 160×80, Database 120×100, Comment 200×120, Group 400×300. Handle positions: top/bottom for StartEnd; top/right/bottom/left for Process, SubProcess; top/bottom for Decision (plus left/right); etc.

- [x] **Step 3: Export from barrel `index.ts`**

  Re-export all types, constants, and `NODE_REGISTRY`.

- [x] **Step 4: Build shared package**

  Run: `pnpm -C packages/shared build`
  Expected: `dist/` generated, no type errors.

- [x] **Step 5: Commit**

  ```bash
  git add -A && git commit -m "feat: shared types + node registry"
  ```

---

### Task 4: Zustand Store + localStorage Persistence

**Files:**
- Create: `packages/web/src/stores/flow-store.ts`
- Create: `packages/web/src/hooks/use-flow-store.ts`
- Create: `packages/web/src/hooks/use-persistence.ts`
- Create: `packages/web/src/lib/storage.ts`
- Create: `packages/web/src/lib/node-utils.ts`

**Interfaces:**
- Consumes: Task 3 types (`FlowNode`, `FlowEdge`, `FlowNodeData`, `FlowNodeType`, `NODE_REGISTRY`)
- Produces:
  - `useFlowStore()` hook returning: `{ nodes, edges, selectedNodeIds, onNodesChange, onEdgesChange, onConnect, addNode(type, position), deleteSelected(), updateNodeData(id, data), updateEdgeData(id, data), setSelectedNodes(ids), undo(), redo() }`
  - `usePersistence()` hook: auto-saves to localStorage on changes (debounced 500ms), loads on mount
  - `createNodeFromType(type: FlowNodeType, position: XYPosition): FlowNode` factory function

- [x] **Step 1: Implement `storage.ts`**

  `saveDiagram(nodes, edges)` and `loadDiagram(): { nodes, edges } | null` wrapping `localStorage` with key `fs-diagram`. JSON serialize/deserialize with error handling.

- [x] **Step 2: Implement `node-utils.ts`**

  `createNodeFromType(type, position)`: reads `NODE_REGISTRY` for defaults, generates `nanoid()` ID, returns `FlowNode` with `data: { label: registry.label, type }`, `style: { width, height }`.

- [x] **Step 3: Implement `flow-store.ts` with Zustand**

  State: `nodes: FlowNode[]`, `edges: FlowEdge[]`, `selectedNodeIds: string[]`, `history: { past, future }`. Actions: `onNodesChange` / `onEdgesChange` (wrap `applyNodeChanges` / `applyEdgeChanges` from `@xyflow/react`), `onConnect` (create edge with `smoothstep` type), `addNode`, `deleteSelected` (remove nodes + connected edges), `updateNodeData`, `updateEdgeData`, `undo` / `redo` (simple snapshot-based, pre-Yjs). Each mutating action pushes to history.

- [x] **Step 4: Implement `use-persistence.ts`**

  Hook that `useEffect`s on `nodes` / `edges` changes → debounced `saveDiagram()`. On mount, `loadDiagram()` and hydrate store.

- [x] **Step 5: Verify round-trip persistence**

  Manually add nodes via store action, refresh page, confirm nodes reload from localStorage with correct positions and data.

- [x] **Step 6: Commit**

  ```bash
  git add -A && git commit -m "feat: zustand store + localStorage persistence"
  ```

---

### Task 5: React Flow Canvas + 模块化图元外壳 (BaseNodeWrapper) + 框选与组合 (Group/Ungroup) + 精密网格吸附 + 正交连线

**Files:**
- Modify: `packages/shared/src/types.ts` (补全 `waypoints?: XYPosition[]` 与 `isFrame?: boolean`)
- Create: `packages/web/src/features/canvas/custom-nodes/base-node-wrapper.tsx` (图元外壳组件：Handles、焦点环、双击内联编辑、样式映射)
- Create: `packages/web/src/features/canvas/utils/group-calculator.ts` (包围盒计算与世界/相对坐标折算工具)
- Create: `packages/web/src/features/canvas/floating-toolbar/contextual-action-bar.tsx` (框选多选与组合的就地悬浮操作条)
- Create: `packages/web/src/features/canvas/custom-nodes/start-end-node.tsx`
- Create: `packages/web/src/features/canvas/custom-nodes/process-node.tsx`
- Create: `packages/web/src/features/canvas/custom-nodes/decision-node.tsx`
- Create: `packages/web/src/features/canvas/custom-nodes/io-node.tsx`
- Create: `packages/web/src/features/canvas/custom-nodes/document-node.tsx`
- Create: `packages/web/src/features/canvas/custom-nodes/subprocess-node.tsx`
- Create: `packages/web/src/features/canvas/custom-nodes/database-node.tsx`
- Create: `packages/web/src/features/canvas/custom-nodes/comment-node.tsx`
- Create: `packages/web/src/features/canvas/custom-nodes/group-node.tsx` (双模组合节点：逻辑组 vs 显式容器 Frame)
- Create: `packages/web/src/features/canvas/custom-nodes/index.ts`
- Create: `packages/web/src/features/canvas/custom-edges/orthogonal-edge.tsx`
- Create: `packages/web/src/features/canvas/custom-edges/index.ts`
- Create: `packages/web/src/features/canvas/canvas-controls.tsx`
- Create: `packages/web/src/features/canvas/flow-canvas.tsx`
- Modify: `packages/web/src/stores/flow-store.ts` (增加 groupSelectedNodes, ungroupNodes, alignSelectedNodes actions)
- Modify: `packages/web/src/app/app.tsx`

**Interfaces:**
- Consumes: Task 4 `useFlowStore()`, Task 3 `NODE_REGISTRY` & `DEFAULT_SNAP_GRID`, Task 2 design tokens, Spec §3.1–§3.5
- Produces:
  - `<FlowCanvas />`: 具备 15px 网格吸附 (`snapToGrid={true}`)、橡皮筋框选 (`selectionMode="partial"`)、全元素自由拖动的无界视口
  - `<BaseNodeWrapper />`: 统一封装 Handles 布局、`--fs-selection-ring` 焦点环、双击内联文本编辑、设计令牌样式映射的图元基底容器
  - `<ContextualActionBar />`: 框选或选组时浮现于选区上方的就地快捷工具栏（一键组合、解散、对齐、删除）
  - 双模组合系统: `groupSelectedNodes(options?)`、`ungroupNodes(groupIds?)`，支持 `Ctrl+G` 成组与整体平移，`Ctrl+Shift+G` 解散，双击穿透聚焦子节点
  - 正交连线: `<OrthogonalEdge />` 90° 直角折线，连线端点随节点自由拖动自适应平滑跟随

- [ ] **Step 1: 补齐 `FlowEdgeData.waypoints` 与 `FlowNodeData.isFrame` 共享类型并构建**

  在 `packages/shared/src/types.ts` 中：
  - 为 `FlowEdgeData` 显式增加 `waypoints?: XYPosition[]`；
  - 为 `FlowNodeData` 增加 `parentId?: string` 与 `isFrame?: boolean`；
  - 运行 `pnpm -C packages/shared build`，确保类型分发且 0 错误。

- [ ] **Step 2: 实现包围盒与相对坐标换算工具 `group-calculator.ts`**

  创建 `packages/web/src/features/canvas/utils/group-calculator.ts`：
  - `computeBoundingBox(nodes: FlowNode[], padding = 20): { x: number; y: number; width: number; height: number }`：计算一组节点在世界坐标系下的最小外接矩形；
  - `toLocalPosition(worldPos: XYPosition, parentPos: XYPosition): XYPosition`；
  - `toWorldPosition(localPos: XYPosition, parentPos: XYPosition): XYPosition`。

- [ ] **Step 3: 在 `flow-store.ts` 中扩充组合 (Group)、解散 (Ungroup) 与对齐 Actions**

  在 `packages/web/src/stores/flow-store.ts` 中扩充：
  - `groupSelectedNodes(options?: { asFrame?: boolean; label?: string })`: 当 `selectedNodeIds.length >= 2` 时，调用 `computeBoundingBox` 动态创建 `group-node`，将选中的子节点坐标转为相对坐标并设置 `parentId`，选中态切换为新创建的 Group，计入撤销栈；
  - `ungroupNodes(groupIds?: string[])`: 遍历指定组或当前选中的组，将直接子节点的相对坐标还原为世界坐标并清除 `parentId`，销毁 group 节点，计入撤销栈；
  - `alignSelectedNodes(alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom')`: 批量对齐选中节点并推入历史栈。

- [ ] **Step 4: 实现 `<BaseNodeWrapper />` 基础图元外壳组件**

  创建 `packages/web/src/features/canvas/custom-nodes/base-node-wrapper.tsx`：
  - 依据 `NODE_REGISTRY[data.type].handles` 自动遍历渲染 `<Handle>`（top/bottom/left/right）；
  - 双击进入内联文本编辑态，回车或失焦调用 `updateNodeData(id, { label })`，ESC 取消；
  - 挂载 `--fs-selection-ring` 焦点环样式；
  - 动态合并 `data.style` 颜色、边框宽度与线型。

- [ ] **Step 5: 基于 `BaseNodeWrapper` 极简化实现 9 大自定义节点组件**

  创建 9 个节点组件（每个组件均精简在 25 行以内）：
  - `start-end-node.tsx`: 圆角胶囊形 (`rounded-full`)
  - `process-node.tsx`: 圆角矩形 (`rounded-lg`)
  - `decision-node.tsx`: 菱形 (SVG 或 `clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)`)
  - `io-node.tsx`: 平行四边形 (`clip-path: polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)`)
  - `document-node.tsx`: 底部波浪矩形 (SVG Path)
  - `subprocess-node.tsx`: 双边框矩形
  - `database-node.tsx`: 圆柱体 (SVG 顶底椭圆)
  - `comment-node.tsx`: 虚线边框黄色便利贴
  - `group-node.tsx`: 双模组合节点：若 `data.isFrame` 则渲染标题栏、折叠按钮与半透明底色；若非 frame 则渲染极简蓝色虚线包围框，支持组拖动与内部穿透。
  - 创建 `custom-nodes/index.ts` 导出 `nodeTypes` 对象。

- [ ] **Step 6: 实现 `OrthogonalEdge` 正交直角连线与注册表**

  创建 `packages/web/src/features/canvas/custom-edges/orthogonal-edge.tsx`：
  - 基于 `@xyflow/react` 的 `getSmoothStepPath({ ..., borderRadius: 0 })` 生成经典 90° 正交折线；
  - 渲染终点箭头标记与 `data.label` 连线文本；
  - 在 `custom-edges/index.ts` 导出 `edgeTypes`（映射 `'orthogonal'` 为默认连线类型）。

- [ ] **Step 7: 实现就地悬浮快捷操作条 `<ContextualActionBar />`**

  创建 `packages/web/src/features/canvas/floating-toolbar/contextual-action-bar.tsx`：
  - 当 `selectedNodeIds.length >= 2` 或选中的是 Group 节点时，实时计算选区顶部坐标并在其上方 12px 悬浮渲染；
  - 包含快捷按钮：【组合 (Ctrl+G)】/【解散组合 (Ctrl+Shift+G)】、【左/中/右/顶/底对齐】、【快速上色】、【删除】。

- [ ] **Step 8: 实现 `<CanvasControls />` 辅助组件**

  创建 `packages/web/src/features/canvas/canvas-controls.tsx`：
  - 左下角浮层：放大、缩小、自适应视口 `fitView`、Minimap 切换按钮，集成 `@xyflow/react` 的 `<MiniMap>`。

- [ ] **Step 9: 实现 `<FlowCanvas />` 画布核心组件**

  创建 `packages/web/src/features/canvas/flow-canvas.tsx`：
  - 组装 `<ReactFlow>`，注入 `nodeTypes`、`edgeTypes`；
  - 显式配置 `snapToGrid={true}` 与 `snapGrid={DEFAULT_SNAP_GRID}` (15px)；
  - 配置 `selectionMode="partial"` 启用鼠标框选相交选择；
  - 配置 `defaultEdgeOptions={{ type: 'orthogonal' }}`；
  - 绑定快捷键：`Ctrl+G` 组合、`Ctrl+Shift+G` 解散组合、`Delete` 批量删除、`Ctrl+Z` / `Ctrl+Shift+Z` 撤销重做；
  - 挂载点阵背景 `<Background gap={15} size={1} />`、`<ContextualActionBar />` 与 `<CanvasControls />`。

- [ ] **Step 10: 在 `app.tsx` 中装配 `<FlowCanvas />`**

  在 `packages/web/src/app/app.tsx` 中引入 `<FlowCanvas />` 并替换占位块，确保全屏响应式铺满。

- [ ] **Step 11: 综合验证与质量验收**

  - 运行 `pnpm -C packages/shared build && pnpm -C packages/web exec tsc --noEmit`，确保类型检查 0 错误；
  - 验证全元素自由拖拽并以 15px 网格吸附对齐；
  - 验证鼠标橡皮筋框选多选；
  - 验证框选后按 `Ctrl+G` 成组，拖动组合整体平移，内部连线自适应跟随；
  - 验证双击进入组内微调单个子节点；
  - 验证按 `Ctrl+Shift+G` 解散组合，坐标还原且无视觉跳跃；
  - 验证双击图元内联修改文字，回车保存并存入撤销历史；
  - 验证连线两端节点拖动时，正交直角折线平滑跟随。

- [ ] **Step 12: Commit**

  ```bash
  git add -A && git commit -m "feat(canvas): modular base node wrapper, 9 custom nodes, orthogonal edges, marquee selection, hybrid grouping, and snap-to-grid"
  ```

---

### Task 6: Shape Palette (Left Sidebar) + Drag-to-Add

**Files:**
- Create: `packages/web/src/features/sidebar/shape-palette.tsx`

**Interfaces:**
- Consumes: Task 3 `NODE_REGISTRY`, Task 4 `useFlowStore().addNode()`, Task 2 design tokens
- Produces: `<ShapePalette />` — left sidebar listing all 9 node types as draggable cards; dropping onto canvas creates a node at drop position.

- [ ] **Step 1: Implement `<ShapePalette />`**

  Render a vertical panel (width ~200px, collapsible) listing all entries from `NODE_REGISTRY`. Each item: icon + label, styled as a card. Use HTML5 drag-and-drop: `onDragStart` sets `dataTransfer` with node type.

- [ ] **Step 2: Handle drop on canvas**

  In `<FlowCanvas />`, add `onDrop` handler: read node type from `dataTransfer`, compute canvas position via `reactFlowInstance.screenToFlowPosition()`, call `addNode(type, position)`.

- [ ] **Step 3: Verify drag-and-drop flow**

  Drag a "处理" card from palette → drop on canvas → node appears at correct position with default label "处理". Repeat for all 9 types.

- [ ] **Step 4: Commit**

  ```bash
  git add -A && git commit -m "feat: shape palette + drag-to-add nodes"
  ```

---

### Task 7: Property Panel (Right Sidebar)

**Files:**
- Create: `packages/web/src/features/sidebar/property-panel.tsx`

**Interfaces:**
- Consumes: Task 4 `useFlowStore().selectedNodeIds`, `updateNodeData()`, `updateEdgeData()`; Task 2 design tokens
- Produces: `<PropertyPanel />` — right sidebar that appears when a node or edge is selected, showing editable fields: label, fill color, border color, border width, border style, font size, font color (for nodes); stroke color, stroke width, stroke style, label (for edges).

- [ ] **Step 1: Implement `<PropertyPanel />`**

  Conditionally render when `selectedNodeIds.length === 1` (node) or a single edge is selected. Read current data from store, render form fields. Use shadcn `<Input>`, `<Select>`, color picker (simple `<input type="color">`), number inputs. Each change calls `updateNodeData()` / `updateEdgeData()` immediately (controlled inputs).

- [ ] **Step 2: Handle edge selection**

  React Flow's `onEdgeClick` → store selected edge ID. Property panel switches between node/edge mode.

- [ ] **Step 3: Verify property editing**

  Select a Process node → change fill to blue → node updates in real-time. Select an edge → change to dashed → edge updates. Deselect → panel hides.

- [ ] **Step 4: Commit**

  ```bash
  git add -A && git commit -m "feat: property panel for node/edge editing"
  ```

---

### Task 8: Floating Toolbar

**Files:**
- Create: `packages/web/src/features/toolbar/floating-toolbar.tsx`
- Create: `packages/web/src/features/toolbar/toolbar-button.tsx`

**Interfaces:**
- Consumes: Task 4 `useFlowStore()`, Task 2 design tokens
- Produces: `<FloatingToolbar />` — bottom-center hovering bar with tool buttons: Select/Move (pointer), Pan (hand), Connect (arrow), Text (type), Undo, Redo, Delete. Frosted glass aesthetic (`backdrop-filter: blur`).

- [ ] **Step 1: Implement `<ToolbarButton />`**

  Reusable icon button with active state, tooltip, keyboard shortcut hint. Frosted glass surface.

- [ ] **Step 2: Implement `<FloatingToolbar />`**

  Fixed bottom-center position. Tool modes: `select` (default, pointer cursor), `pan` (hand cursor, `panOnDrag`), `connect` (crosshair cursor). Undo/Redo buttons with disabled state based on history. Delete button enabled when selection exists. Dividers between tool groups.

- [ ] **Step 3: Wire tool modes into canvas**

  `FlowCanvas` reads active tool from store: `panOnDrag` when pan mode, `connectionMode` when connect mode. Cursor changes accordingly.

- [ ] **Step 4: Verify toolbar interaction**

  Click pan tool → drag canvas without moving nodes. Click select → drag moves nodes. Undo/redo work. Delete removes selected.

- [ ] **Step 5: Commit**

  ```bash
  git add -A && git commit -m "feat: floating toolbar with tool modes"
  ```

---

### Task 9: Top Bar + Full Layout Assembly

**Files:**
- Create: `packages/web/src/features/topbar/top-bar.tsx`
- Modify: `packages/web/src/app/app.tsx` — assemble full layout

**Interfaces:**
- Consumes: All previous tasks
- Produces: `<TopBar />` with diagram title (editable), theme toggle, export placeholder button. Full editor layout: TopBar + ShapePalette (left) + FlowCanvas (center) + PropertyPanel (right, conditional) + FloatingToolbar (bottom center) + CanvasControls (bottom left).

- [ ] **Step 1: Implement `<TopBar />`**

  Height ~48px, frosted glass. Left: editable diagram title (`<input>` inline edit). Right: theme toggle, export button (placeholder, logs to console). Logo/app name "FlowStudio" far left.

- [ ] **Step 2: Assemble full layout in `app.tsx`**

  CSS grid or flex layout: TopBar fixed top, ShapePalette absolute left (collapsible), PropertyPanel absolute right (conditional), FlowCanvas fills remaining space, FloatingToolbar + CanvasControls overlay bottom.

- [ ] **Step 3: Full visual walkthrough**

  Light theme: verify all surfaces, borders, text, shadows use tokens. Switch to dark theme: repeat. Resize window: layout adjusts. Collapse left panel: canvas expands.

- [ ] **Step 4: Commit**

  ```bash
  git add -A && git commit -m "feat: top bar + full editor layout assembly"
  ```

---

### Task 10: Polish + M1 Quality Gate

**Files:**
- Modify: various files for polish
- Create: `packages/web/src/features/canvas/keyboard-shortcuts.ts` (if not already inline)

**Interfaces:**
- Consumes: all previous tasks
- Produces: M1 deliverable passing all quality gates from §5.11 and the spec

- [ ] **Step 1: Keyboard shortcuts audit**

  Verify: `Delete/Backspace` → delete selected, `Ctrl+Z` → undo, `Ctrl+Shift+Z` → redo, `Ctrl+A` → select all, `Ctrl+C/V` → copy/paste nodes (React Flow built-in). Double-click node → inline label edit.

- [ ] **Step 2: Theme visual audit**

  Screenshot every component in light and dark theme. Fix any leaked colors (hardcoded hex, missing token usage).

- [ ] **Step 3: 200-node stress test**

  Programmatically add 200 Process nodes with random edges. Pan, zoom, select — verify no jank (>30 FPS).

- [ ] **Step 4: Persistence round-trip test**

  Create a diagram with all 9 node types, multiple edges with labels and custom styles. Refresh. Verify exact data match.

- [ ] **Step 5: Node registry extensibility test**

  Add a dummy `Test` node type to registry + one simple component. Verify it appears in ShapePalette, renders on canvas, editable in PropertyPanel — without touching any other file.

- [ ] **Step 6: Final commit**

  ```bash
  git add -A && git commit -m "feat: M1 complete — canvas, nodes, toolbar, theme, persistence"
  ```

---

## M1 验收清单（映射设计文档）

| 设计文档要求 | 对应 Task | 验收方式 |
|---|---|---|
| §5.1 Vite + React 19 + TS + Tailwind + shadcn + React Flow + Zustand | Task 1 | `pnpm dev` 无报错 |
| §5.4 九种流程图节点类型 | Task 5 | 所有节点可拖放、连线、编辑 |
| §5.6 直角走线 + 箭头 + 标签 + 实虚线 | Task 5 | 连线直角、属性可编辑 |
| §5.11 现代界面、悬浮工具条、面板布局 | Task 6-9 | 视觉走查通过 |
| §5.11 亮暗主题 | Task 2, 10 | 切换无漏色 |
| 本地持久化（M2 前的过渡方案） | Task 4 | 刷新不丢数据 |
