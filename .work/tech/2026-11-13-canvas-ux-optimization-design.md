# 画布交互与侧边栏体验优化设计

## 背景与目标
提升 FlowStudio 画布操作效率、视觉聚焦体验与画布空间利用率，支持键盘临时平移、选中即走查、按需属性面板以及紧凑型左侧图元栏。

## 非目标与约束
- 不改动 MCP 服务端契约、Y.Doc 协同数据结构与泳道布局算法（纯前端 UI 与本地交互层优化）。
- 严格区分演讲模式（`isPresenting`）与输入框编辑态，避免快捷键冲突。

## 选定方案与交互设计

### 1. 空格临时平移（`FlowCanvas`）
- **方案**：在 `FlowCanvas` 内维护本地 `isSpacePanning` 状态，不修改 `useFlowStore.activeTool`。
- **触发条件**：画布容器获得焦点（或鼠标在画布内且非 `INPUT`/`TEXTAREA`/`contentEditable`）、非演讲模式（`!isPresenting`）时，按下 `Space` 阻止默认滚动并开启 `isSpacePanning = true`；松开 `Space` 或窗口 `blur` 时复位为 `false`。
- **交互表现**：`isSpacePanning` 为 `true` 时，ReactFlow 临时切换为 `panOnDrag={[0, 1, 2]}`、`selectionOnDrag={false}`、`nodesDraggable={false}`、`nodesConnectable={false}`，光标显示抓手（`cursor-grab` / `cursor-grabbing`）；松开后恢复原 `activeTool`。

### 2. 选中即走查 + 右上角全局链路走查（方案 B）
- **单选自动走查**：在 `FlowCanvas` 中，当单选节点（`selectedNodeIds.length === 1 && !selectedEdgeId`）或单选连线（`Boolean(selectedEdgeId) && selectedNodeIds.length === 0`）时，自动调用 `computePathSpotlight` 高亮该元素的上下游因果链路，非链路元素降噪；取消选中（点击空白、`Esc`）或多选时自动清除单选走查。
- **全局链路走查**：右上角「链路走查」按钮（`TopBar`）控制 `spotlightActive` 全局模式。开启且未单选具体元素时，通过 `computeGlobalPathSpotlight` 高亮全图所有参与连线的节点、连线及途经泳道（孤立节点降噪）；全局模式下点击具体元素可聚焦该元素单条链路；再次点击按钮或按 `Esc` 退出全局走查。

### 3. 右侧属性面板按需显隐（`PropertyPanel`）
- 当 `selectedNodeIds.length === 0 && !selectedEdgeId` 时，`PropertyPanel` 直接返回 `null`，不渲染占位容器，画布自动占满右侧区域；选中节点（单选/多选）或连线时立即显示。

### 4. 左侧元素栏紧凑化（`ElementsPanel` + `SidebarDock`）
- 去掉 `ElementsPanel` 顶部的 `NODE_CATEGORIES` 左右切换 Tab，在一个可滚动侧边栏内按分类标题分组连续展示所有图元（搜索时同样按命中分组过滤展示）。
- 去掉图元卡片底部的文字标签，保留 `title` 悬浮提示（名称与描述）。
- 网格改为 `grid-cols-4` 紧凑图标排布，`SidebarDock` 中元素面板宽度（或二级面板宽度）收窄至 `w-52`，进一步释放画布视野。

## 影响文件
- `packages/web/src/features/canvas/utils/path-spotlight.ts`（新增 `computeGlobalPathSpotlight`）
- `packages/web/src/features/canvas/flow-canvas.tsx`（空格平移、单选/全局链路走查联动）
- `packages/web/src/features/topbar/top-bar.tsx`（全局链路走查按钮状态与提示）
- `packages/web/src/features/sidebar/property-panel.tsx`（未选中返回 `null`）
- `packages/web/src/features/sidebar/tabs/elements-panel.tsx` & `sidebar-dock.tsx`（紧凑 4 列无文字分组视图）
- `packages/web/tests/path-spotlight.test.ts`（补充 `computeGlobalPathSpotlight` 单测）
