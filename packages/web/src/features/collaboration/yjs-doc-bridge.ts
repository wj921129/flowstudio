import * as Y from 'yjs';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import type { DiagramBridgeState } from './types.js';
import { DEFAULT_THEME_ID, type ThemePreset } from '../sidebar/styles/theme-presets';
import { resolveNodeStyle } from '../sidebar/styles/style-resolver';

export interface YjsDiagramBridgeOptions {
  localClientId: string;
}

/**
 * 递归排序对象键名，使字段比较不受属性写入顺序影响
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      ordered[key] = canonicalize(source[key]);
    }
    return ordered;
  }
  return value;
}

function sameValue(current: unknown, next: unknown): boolean {
  if (current === next) return true;
  if (current === null || next === null) return false;
  if (typeof current !== 'object' || typeof next !== 'object') return false;
  return JSON.stringify(canonicalize(current)) === JSON.stringify(canonicalize(next));
}

function clonePlain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export class YjsDiagramBridge {
  private doc: Y.Doc;
  private localClientId: string;
  private nodesMap: Y.Map<Y.Map<unknown>>;
  private edgesMap: Y.Map<Y.Map<unknown>>;
  private metaMap: Y.Map<unknown>;
  private listeners: Set<(state: DiagramBridgeState) => void> = new Set();
  private unobserveCallbacks: Array<() => void> = [];

  constructor(doc: Y.Doc, options: YjsDiagramBridgeOptions) {
    this.doc = doc;
    this.localClientId = options.localClientId;
    this.nodesMap = this.doc.getMap<Y.Map<unknown>>('nodes');
    this.edgesMap = this.doc.getMap<Y.Map<unknown>>('edges');
    this.metaMap = this.doc.getMap<unknown>('meta');

    this.setupObservers();
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  getLocalClientId(): string {
    return this.localClientId;
  }

  getTitle(): string {
    const title = this.metaMap.get('title');
    return typeof title === 'string' ? title : '未命名流程图';
  }

  getRawTitle(): string | undefined {
    const title = this.metaMap.get('title');
    return typeof title === 'string' && title.trim() ? title.trim() : undefined;
  }

  setTitle(title: string): void {
    this.transact(() => {
      this.metaMap.set('title', title.trim());
    });
  }

  getThemeId(): string {
    const themeId = this.metaMap.get('themeId');
    return typeof themeId === 'string' ? themeId : DEFAULT_THEME_ID;
  }

  setThemeId(themeId: string): void {
    this.transact(() => {
      this.metaMap.set('themeId', themeId);
    });
  }

  applyTheme(theme: ThemePreset, preserveManual: boolean = true): void {
    applyThemeToYDoc(this.doc, theme, preserveManual, this.localClientId);
  }

  getState(): DiagramBridgeState {
    return this.toReactFlowState();
  }

  transact(fn: () => void, origin: string = this.localClientId): void {
    this.doc.transact(fn, origin);
  }

  /**
   * 对齐目标图表状态（原子事务）
   * 按 key 做增量 diff：只删除消失的条目、只写入真正变化的字段，
   * 避免每次提交都清空重建而累积数百万 CRDT 历史条目。
   */
  setDiagram(nodes: FlowNode[], edges: FlowEdge[]): void {
    this.transact(() => {
      const nodeIdSet = new Set(nodes.map((node) => node.id));
      for (const id of Array.from(this.nodesMap.keys())) {
        if (!nodeIdSet.has(id)) this.nodesMap.delete(id);
      }
      for (const node of nodes) {
        this.upsertNode(node);
      }

      const edgeIdSet = new Set(edges.map((edge) => edge.id));
      for (const id of Array.from(this.edgesMap.keys())) {
        if (!edgeIdSet.has(id)) this.edgesMap.delete(id);
      }
      for (const edge of edges) {
        this.upsertEdge(edge);
      }
    });
  }

  /**
   * 写入或更新节点集合
   */
  putNodes(nodes: FlowNode[]): void {
    this.transact(() => {
      for (const node of nodes) {
        this.upsertNode(node);
      }
    });
  }

  /**
   * 单节点局部 Patch
   */
  patchNode(id: string, patch: Partial<FlowNode>): void {
    this.transact(() => {
      const itemMap = this.nodesMap.get(id);
      if (!itemMap) return;

      if (patch.position !== undefined) this.setField(itemMap, 'position', { x: patch.position.x, y: patch.position.y });
      if (patch.type !== undefined) this.setField(itemMap, 'type', patch.type);
      if (patch.parentId !== undefined) this.setField(itemMap, 'parentId', patch.parentId);
      if (patch.extent !== undefined) this.setField(itemMap, 'extent', patch.extent);
      if (patch.width !== undefined) this.setField(itemMap, 'width', patch.width);
      if (patch.height !== undefined) this.setField(itemMap, 'height', patch.height);
      if (patch.zIndex !== undefined) this.setField(itemMap, 'zIndex', patch.zIndex);
      if (patch.style !== undefined) this.setField(itemMap, 'style', patch.style);
      if (patch.className !== undefined) this.setField(itemMap, 'className', patch.className);
      if (patch.data !== undefined) {
        const existingData = (itemMap.get('data') as Record<string, unknown>) || {};
        this.setJsonField(itemMap, 'data', { ...existingData, ...patch.data });
      }
    });
  }

  /**
   * 批量节点局部 Patch
   */
  patchNodes(patches: Array<{ id: string; patch: Partial<FlowNode> }>): void {
    this.transact(() => {
      for (const { id, patch } of patches) {
        this.patchNode(id, patch);
      }
    });
  }

  /**
   * 删除节点集合，并级联清除相连的边
   */
  removeNodes(ids: string[]): void {
    if (ids.length === 0) return;
    const idSet = new Set(ids);

    this.transact(() => {
      for (const id of ids) {
        this.nodesMap.delete(id);
      }

      // 级联清理以这些节点为 source 或 target 的 edges
      const edgeKeysToDelete: string[] = [];
      this.edgesMap.forEach((edgeMap, edgeId) => {
        const source = edgeMap.get('source') as string | undefined;
        const target = edgeMap.get('target') as string | undefined;
        if ((source && idSet.has(source)) || (target && idSet.has(target))) {
          edgeKeysToDelete.push(edgeId);
        }
      });

      for (const edgeId of edgeKeysToDelete) {
        this.edgesMap.delete(edgeId);
      }
    });
  }

  /**
   * 写入或更新连线集合
   */
  putEdges(edges: FlowEdge[]): void {
    this.transact(() => {
      for (const edge of edges) {
        this.upsertEdge(edge);
      }
    });
  }

  /**
   * 单连线局部 Patch
   */
  patchEdge(id: string, patch: Partial<FlowEdge>): void {
    this.transact(() => {
      const edgeItem = this.edgesMap.get(id);
      if (!edgeItem) return;

      if (patch.source !== undefined) this.setField(edgeItem, 'source', patch.source);
      if (patch.target !== undefined) this.setField(edgeItem, 'target', patch.target);
      if (patch.sourceHandle !== undefined) this.setField(edgeItem, 'sourceHandle', patch.sourceHandle);
      if (patch.targetHandle !== undefined) this.setField(edgeItem, 'targetHandle', patch.targetHandle);
      if (patch.type !== undefined) this.setField(edgeItem, 'type', patch.type);
      if (patch.label !== undefined) this.setField(edgeItem, 'label', patch.label);
      if (patch.animated !== undefined) this.setField(edgeItem, 'animated', patch.animated);
      if (patch.style !== undefined) this.setField(edgeItem, 'style', patch.style);
      if (patch.data !== undefined) {
        const existingData = (edgeItem.get('data') as Record<string, unknown>) || {};
        this.setJsonField(edgeItem, 'data', { ...existingData, ...patch.data });
      }
    });
  }

  /**
   * 删除连线集合
   */
  removeEdges(ids: string[]): void {
    if (ids.length === 0) return;
    this.transact(() => {
      for (const id of ids) {
        this.edgesMap.delete(id);
      }
    });
  }

  /**
   * 导出为 React Flow 标准状态（执行拓扑排序并剔除悬挂边）
   */
  toReactFlowState(): DiagramBridgeState {
    const rawNodes: FlowNode[] = [];
    const nodeIds = new Set<string>();

    this.nodesMap.forEach((nodeMap, id) => {
      const node = this.readNodeFromYMap(nodeMap, id);
      if (node) {
        rawNodes.push(node);
        nodeIds.add(id);
      }
    });

    // 拓扑排序：父容器优先于子节点
    const sortedNodes = this.sortNodesTopologically(rawNodes);

    const validEdges: FlowEdge[] = [];
    this.edgesMap.forEach((edgeMap, id) => {
      const edge = this.readEdgeFromYMap(edgeMap, id);
      if (edge && nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        validEdges.push(edge);
      }
    });

    return {
      nodes: sortedNodes,
      edges: validEdges,
      title: this.getTitle(),
      themeId: this.getThemeId(),
    };
  }

  subscribe(listener: (state: DiagramBridgeState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    for (const unobserve of this.unobserveCallbacks) {
      unobserve();
    }
    this.unobserveCallbacks = [];
    this.listeners.clear();
  }

  private setupObservers(): void {
    const notify = () => {
      if (this.listeners.size === 0) return;
      const state = this.toReactFlowState();
      for (const listener of this.listeners) {
        listener(state);
      }
    };

    const nodeObserver = () => notify();
    const edgeObserver = () => notify();
    const metaObserver = () => notify();

    this.nodesMap.observeDeep(nodeObserver);
    this.edgesMap.observeDeep(edgeObserver);
    this.metaMap.observe(metaObserver);

    this.unobserveCallbacks.push(() => {
      this.nodesMap.unobserveDeep(nodeObserver);
      this.edgesMap.unobserveDeep(edgeObserver);
      this.metaMap.unobserve(metaObserver);
    });
  }

  private upsertNode(node: FlowNode): void {
    let itemMap = this.nodesMap.get(node.id);
    if (!itemMap) {
      itemMap = new Y.Map<unknown>();
      this.nodesMap.set(node.id, itemMap);
    }
    this.writeNodeToYMap(itemMap, node);
  }

  private upsertEdge(edge: FlowEdge): void {
    let edgeItem = this.edgesMap.get(edge.id);
    if (!edgeItem) {
      edgeItem = new Y.Map<unknown>();
      this.edgesMap.set(edge.id, edgeItem);
    }
    this.writeEdgeToYMap(edgeItem, edge);
  }

  /**
   * 字段值未变化时跳过写入，undefined 视为删除
   */
  private setField(item: Y.Map<unknown>, key: string, value: unknown): void {
    if (value === undefined) {
      if (item.has(key)) item.delete(key);
      return;
    }
    if (sameValue(item.get(key), value)) return;
    item.set(key, value);
  }

  private setJsonField(item: Y.Map<unknown>, key: string, value: unknown): void {
    if (value === undefined) {
      if (item.has(key)) item.delete(key);
      return;
    }
    if (sameValue(item.get(key), value)) return;
    item.set(key, clonePlain(value));
  }

  private writeNodeToYMap(item: Y.Map<unknown>, node: FlowNode): void {
    this.setField(item, 'id', node.id);
    this.setField(item, 'type', node.type);
    this.setField(item, 'position', { x: node.position.x, y: node.position.y });
    this.setJsonField(item, 'data', node.data);
    this.setField(item, 'parentId', node.parentId);
    this.setField(item, 'extent', node.extent);
    this.setField(item, 'width', node.width);
    this.setField(item, 'height', node.height);
    this.setField(item, 'zIndex', node.zIndex);
    this.setField(item, 'style', node.style);
    this.setField(item, 'className', node.className);
  }

  private readNodeFromYMap(item: Y.Map<unknown>, fallbackId: string): FlowNode | null {
    const id = (item.get('id') as string) || fallbackId;
    const type = item.get('type') as FlowNode['type'];
    const pos = item.get('position') as FlowNode['position'] | undefined;
    const data = item.get('data') as FlowNode['data'] | undefined;

    if (!type || !pos || !data) return null;

    const node: FlowNode = {
      id,
      type,
      position: { x: pos.x, y: pos.y },
      data: { ...data },
    };

    const parentId = item.get('parentId') as string | undefined;
    if (parentId) node.parentId = parentId;

    const extent = item.get('extent') as 'parent' | undefined;
    if (extent) node.extent = extent;

    const width = item.get('width') as number | undefined;
    if (typeof width === 'number') node.width = width;

    const height = item.get('height') as number | undefined;
    if (typeof height === 'number') node.height = height;

    const zIndex = item.get('zIndex') as number | undefined;
    if (typeof zIndex === 'number') node.zIndex = zIndex;

    const style = item.get('style') as Record<string, unknown> | undefined;
    if (style) node.style = style;

    const className = item.get('className') as string | undefined;
    if (className) node.className = className;

    return node;
  }

  private writeEdgeToYMap(item: Y.Map<unknown>, edge: FlowEdge): void {
    this.setField(item, 'id', edge.id);
    this.setField(item, 'source', edge.source);
    this.setField(item, 'target', edge.target);
    this.setField(item, 'sourceHandle', edge.sourceHandle);
    this.setField(item, 'targetHandle', edge.targetHandle);
    this.setField(item, 'type', edge.type);
    this.setField(item, 'label', edge.label);
    this.setField(item, 'animated', edge.animated);
    this.setField(item, 'style', edge.style);
    this.setJsonField(item, 'data', edge.data);
  }

  private readEdgeFromYMap(item: Y.Map<unknown>, fallbackId: string): FlowEdge | null {
    const id = (item.get('id') as string) || fallbackId;
    const source = item.get('source') as string | undefined;
    const target = item.get('target') as string | undefined;

    if (!source || !target) return null;

    const edge: FlowEdge = {
      id,
      source,
      target,
    };

    const sourceHandle = item.get('sourceHandle') as string | undefined;
    if (sourceHandle) edge.sourceHandle = sourceHandle;

    const targetHandle = item.get('targetHandle') as string | undefined;
    if (targetHandle) edge.targetHandle = targetHandle;

    const type = item.get('type') as string | undefined;
    if (type) edge.type = type;

    const label = item.get('label') as string | undefined;
    if (label) edge.label = label;

    const animated = item.get('animated') as boolean | undefined;
    if (typeof animated === 'boolean') edge.animated = animated;

    const style = item.get('style') as Record<string, unknown> | undefined;
    if (style) edge.style = style;

    const data = item.get('data') as FlowEdge['data'] | undefined;
    if (data) edge.data = data;

    return edge;
  }

  private sortNodesTopologically(nodes: FlowNode[]): FlowNode[] {
    const parents: FlowNode[] = [];
    const children: FlowNode[] = [];

    for (const node of nodes) {
      if (node.parentId) {
        children.push(node);
      } else {
        parents.push(node);
      }
    }

    // 父容器在前，子节点在后
    return [...parents, ...children];
  }
}

/**
 * 在单一原子事务中将主题风格应用至 Y.Doc，支持保持手动自定义样式
 */
export function applyThemeToYDoc(
  doc: Y.Doc,
  theme: ThemePreset,
  preserveManual: boolean = true,
  origin?: string
): void {
  const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
  const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
  const metaMap = doc.getMap<unknown>('meta');

  doc.transact(() => {
    metaMap.set('themeId', theme.id);

    nodesMap.forEach((itemMap) => {
      const type = itemMap.get('type') as string;
      if (!type || type === 'group' || type === 'lane' || type === 'comment') return;

      const rawData = itemMap.get('data') as Record<string, unknown> | undefined;
      const data = rawData ? JSON.parse(JSON.stringify(rawData)) : { type, label: '' };
      const style = (data.style as Record<string, unknown>) || {};

      if (preserveManual && style.isManualCustom === true) {
        return;
      }

      const computed = resolveNodeStyle(type, theme);
      const nextStyle = {
        ...style,
        ...computed,
        isManualCustom: false,
      };

      data.style = nextStyle;
      if (type === 'pool' && computed.headerColor) {
        data.headerColor = computed.headerColor;
      }

      itemMap.set('data', data);
    });

    edgesMap.forEach((edgeItem) => {
      const currentStyle = (edgeItem.get('style') as Record<string, unknown>) || {};
      edgeItem.set('style', {
        ...currentStyle,
        stroke: theme.tokens.edgeStroke,
      });
    });
  }, origin);
}

