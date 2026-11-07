import * as Y from 'yjs';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import type { DiagramBridgeState } from './types.js';

export interface YjsDiagramBridgeOptions {
  localClientId: string;
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

  setTitle(title: string): void {
    this.transact(() => {
      this.metaMap.set('title', title.trim());
    });
  }

  transact(fn: () => void, origin: string = this.localClientId): void {
    this.doc.transact(fn, origin);
  }

  /**
   * 全量替换或重置图表（原子事务）
   */
  setDiagram(nodes: FlowNode[], edges: FlowEdge[]): void {
    this.transact(() => {
      // 清空现有
      this.nodesMap.clear();
      this.edgesMap.clear();

      // 写入节点
      for (const node of nodes) {
        const itemMap = new Y.Map<unknown>();
        this.writeNodeToYMap(itemMap, node);
        this.nodesMap.set(node.id, itemMap);
      }

      // 写入连线
      for (const edge of edges) {
        const edgeItem = new Y.Map<unknown>();
        this.writeEdgeToYMap(edgeItem, edge);
        this.edgesMap.set(edge.id, edgeItem);
      }
    });
  }

  /**
   * 写入或更新节点集合
   */
  putNodes(nodes: FlowNode[]): void {
    this.transact(() => {
      for (const node of nodes) {
        let itemMap = this.nodesMap.get(node.id);
        if (!itemMap) {
          itemMap = new Y.Map<unknown>();
          this.nodesMap.set(node.id, itemMap);
        }
        this.writeNodeToYMap(itemMap, node);
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

      if (patch.position !== undefined) itemMap.set('position', patch.position);
      if (patch.type !== undefined) itemMap.set('type', patch.type);
      if (patch.parentId !== undefined) itemMap.set('parentId', patch.parentId);
      if (patch.extent !== undefined) itemMap.set('extent', patch.extent);
      if (patch.width !== undefined) itemMap.set('width', patch.width);
      if (patch.height !== undefined) itemMap.set('height', patch.height);
      if (patch.zIndex !== undefined) itemMap.set('zIndex', patch.zIndex);
      if (patch.style !== undefined) itemMap.set('style', patch.style);
      if (patch.className !== undefined) itemMap.set('className', patch.className);
      if (patch.data !== undefined) {
        const existingData = (itemMap.get('data') as Record<string, unknown>) || {};
        itemMap.set('data', { ...existingData, ...patch.data });
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
        let edgeItem = this.edgesMap.get(edge.id);
        if (!edgeItem) {
          edgeItem = new Y.Map<unknown>();
          this.edgesMap.set(edge.id, edgeItem);
        }
        this.writeEdgeToYMap(edgeItem, edge);
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

      if (patch.source !== undefined) edgeItem.set('source', patch.source);
      if (patch.target !== undefined) edgeItem.set('target', patch.target);
      if (patch.sourceHandle !== undefined) edgeItem.set('sourceHandle', patch.sourceHandle);
      if (patch.targetHandle !== undefined) edgeItem.set('targetHandle', patch.targetHandle);
      if (patch.type !== undefined) edgeItem.set('type', patch.type);
      if (patch.label !== undefined) edgeItem.set('label', patch.label);
      if (patch.animated !== undefined) edgeItem.set('animated', patch.animated);
      if (patch.style !== undefined) edgeItem.set('style', patch.style);
      if (patch.data !== undefined) {
        const existingData = (edgeItem.get('data') as Record<string, unknown>) || {};
        edgeItem.set('data', { ...existingData, ...patch.data });
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

  private writeNodeToYMap(item: Y.Map<unknown>, node: FlowNode): void {
    item.set('id', node.id);
    item.set('type', node.type);
    item.set('position', { x: node.position.x, y: node.position.y });
    item.set('data', JSON.parse(JSON.stringify(node.data)));

    if (node.parentId !== undefined) item.set('parentId', node.parentId);
    else item.delete('parentId');

    if (node.extent !== undefined) item.set('extent', node.extent);
    else item.delete('extent');

    if (node.width !== undefined) item.set('width', node.width);
    else item.delete('width');

    if (node.height !== undefined) item.set('height', node.height);
    else item.delete('height');

    if (node.zIndex !== undefined) item.set('zIndex', node.zIndex);
    else item.delete('zIndex');

    if (node.style !== undefined) item.set('style', node.style);
    else item.delete('style');

    if (node.className !== undefined) item.set('className', node.className);
    else item.delete('className');
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
    item.set('id', edge.id);
    item.set('source', edge.source);
    item.set('target', edge.target);

    if (edge.sourceHandle !== undefined) item.set('sourceHandle', edge.sourceHandle);
    else item.delete('sourceHandle');

    if (edge.targetHandle !== undefined) item.set('targetHandle', edge.targetHandle);
    else item.delete('targetHandle');

    if (edge.type !== undefined) item.set('type', edge.type);
    else item.delete('type');

    if (edge.label !== undefined) item.set('label', edge.label);
    else item.delete('label');

    if (edge.animated !== undefined) item.set('animated', edge.animated);
    else item.delete('animated');

    if (edge.style !== undefined) item.set('style', edge.style);
    else item.delete('style');

    if (edge.data !== undefined) item.set('data', JSON.parse(JSON.stringify(edge.data)));
    else item.delete('data');
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
