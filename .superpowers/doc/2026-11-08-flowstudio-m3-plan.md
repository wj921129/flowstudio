# FlowStudio M3 实施计划：泳道系统、elkjs 自动排版与直角走线增强

> **目标**：实现商业级泳道图系统（Pool & Lane 横向/纵向、拖拽吸附、自动撑开、嵌套关系管理）、基于 elkjs 的流程图与泳道自动排版引擎、支持折点（Waypoints）交互调整的直角连线体系，通过全套自动化测试和编译验证。

---

## 阶段任务拆分（Tasks 1 ~ 7）

### Task 1: 共享层泳道契约与 Schema 扩充
- **改哪里**：`packages/shared/src/types.ts`、`packages/shared/src/node-registry.ts`、`packages/shared/src/schemas/diagram-schema.ts`
- **改什么**：
  - 增加 `pool` 与 `lane` 节点类型定义，支持 `orientation: 'horizontal' | 'vertical'`、`laneOrder: string[]`、`headerColor?: string` 等属性。
  - 在 `NODE_REGISTRY` 注册泳道元数据、默认尺寸、连接桩与描述。
  - 更新 Zod 校验，确保 Yjs 协同和 API 传输合规。
- **验收**：`packages/shared/tests/schemas.test.ts` 新增对 pool / lane 的校验并通过。

### Task 2: elkjs 自动排版引擎集成与封装
- **改哪里**：`packages/web/package.json`、`packages/web/src/features/canvas/layout/elk-layout.ts`
- **改什么**：
  - 安装 `elkjs` 与 `@types/elkjs`。
  - 实现通用排版服务 `layoutDiagram(nodes, edges, options)`：
    - 普通流程图采用 `layered` 算法，支持横向（LR）与纵向（TB）。
    - 泳道图采用泳道感知的分区算法（`partitioning`），保持同一泳道内节点紧凑对齐，连线正交走线。
- **验收**：编写 `packages/web/tests/elk-layout.test.ts`，验证多节点及多泳道坐标计算正确性。

### Task 3: 泳道组件实现（PoolNode & LaneNode）
- **改哪里**：`packages/web/src/features/canvas/custom-nodes/pool-node.tsx`、`lane-node.tsx`、`index.ts`
- **改什么**：
  - 实现现代毛玻璃质感、细边框的高颜值泳道池（`PoolNode`）与泳道分栏（`LaneNode`）。
  - 支持横向（Horizontal）与纵向（Vertical）切换，表头自定义文字、拖拽手柄拉伸尺寸。
  - 增删泳道快捷操作（表头添加下一泳道、重命名泳道标签）。
- **验收**：无类型错误，Story/组件渲染及属性响应正常。

### Task 4: 节点拖入/拖出泳道吸附机制与自动撑开
- **改哪里**：`packages/web/src/stores/flow-store.ts`、`packages/web/src/features/canvas/hooks/use-lane-interaction.ts`
- **改什么**：
  - 在节点拖拽结束（`onNodeDragStop`）时，检测节点包围盒是否落入某条泳道。
  - 若落入：自动计算局部相对坐标并赋予 `parentId: laneId`；
  - 若拖出：计算绝对坐标并解除 `parentId`。
  - 泳道容器根据内部子节点包围盒自动撑开外框尺寸，防止内容溢出。
- **验收**：编写 `packages/web/tests/lane-nesting.test.ts` 验证拖入拖出坐标转换与父子绑定。

### Task 5: 直角连线 Waypoint 折点拖拽与路径渲染
- **改哪里**：`packages/web/src/features/canvas/custom-edges/orthogonal-edge.tsx`、`packages/web/src/stores/flow-store.ts`
- **改什么**：
  - 扩展 `OrthogonalEdge` 支持解析 `data.waypoints`。
  - 当连线被选中时，在各个折拐段中点渲染可拖拽的控制手柄（Handle）。
  - 拖拽控制手柄可增加/调整折点坐标，并保存到连线 `data.waypoints` 中。
  - 连线在节点移动后保留用户手调折点，执行一键自动排版时重置为最优直角路径。
- **验收**：编写 `packages/web/tests/orthogonal-edge.test.ts` 验证折点生成与路径构造函数。

### Task 6: 画布工具栏扩展与一键自动排版
- **改哪里**：`packages/web/src/features/canvas/components/canvas-toolbar.tsx`、`node-panel.tsx`、`top-bar.tsx`
- **改什么**：
  - 左侧图形面板增加“泳道图”分类，可一键拖入“横向泳道池”或“纵向泳道池”。
  - 顶部栏/悬浮工具条增加“一键自动排版”按钮与快捷键（带加载反馈与平滑动画过渡）。
- **验收**：界面点击自动排版即可触发动画并调用 elkjs 完成节点重排与动画补间。

### Task 7: M3 综合质量关卡与端到端协同验证
- **改哪里**：`packages/web/tests/m3-quality-gate.test.ts`
- **改什么**：
  - 测试泳道创建、节点拖入泳道、自动排版、协同同步到 Y.Doc 的全流程。
- **验收**：全量单元与集成测试绿通，`pnpm -r build` 编译成功。
