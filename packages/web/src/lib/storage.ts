/**
 * @fileoverview 本地持久化存储封装
 * @description 封装 LocalStorage 读写，提供流程图数据存储、读取及健壮的容错机制
 */

import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import { FS_DIAGRAM_STORAGE_KEY } from '@flowstudio/shared';

/**
 * 本地持久化保存的图表数据结构
 */
export interface PersistedDiagram {
  /** 节点列表 */
  nodes: FlowNode[];
  /** 连线列表 */
  edges: FlowEdge[];
  /** 存储时间戳 (ISO 8601) */
  updatedAt?: string;
  /** Schema 版本 */
  version?: string;
}

/**
 * 校验运行环境是否支持 localStorage
 */
function isStorageAvailable(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }
  try {
    const testKey = '__fs_storage_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理节点瞬态属性（选中、拖拽等交互态）
 */
function sanitizeNodes(nodes: FlowNode[]): FlowNode[] {
  return nodes.map((n) => {
    const { selected, dragging, resizing, ...rest } = n as Record<string, unknown>;
    return rest as FlowNode;
  });
}

/**
 * 清理连线瞬态属性（选中态等）
 */
function sanitizeEdges(edges: FlowEdge[]): FlowEdge[] {
  return edges.map((e) => {
    const { selected, ...rest } = e as Record<string, unknown>;
    return rest as FlowEdge;
  });
}

/**
 * 将流程图节点与连线数据持久化至 localStorage
 * @param nodes 流程图节点集合
 * @param edges 流程图连线集合
 */
export function saveDiagram(nodes: FlowNode[], edges: FlowEdge[]): void {
  if (!isStorageAvailable()) {
    console.warn('[Storage] 当前环境不支持 localStorage，保存操作已跳过');
    return;
  }

  try {
    const payload: PersistedDiagram = {
      nodes: sanitizeNodes(nodes),
      edges: sanitizeEdges(edges),
      updatedAt: new Date().toISOString(),
      version: '1.0',
    };
    const serialized = JSON.stringify(payload);
    window.localStorage.setItem(FS_DIAGRAM_STORAGE_KEY, serialized);
  } catch (error) {
    console.error('[Storage] 保存流程图至 localStorage 失败:', error);
  }
}

/**
 * 从 localStorage 加载流程图数据
 * @returns 包含 nodes 与 edges 的对象；若无存储数据或数据损坏则返回 null
 */
export function loadDiagram(): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  if (!isStorageAvailable()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(FS_DIAGRAM_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;

    // 结构完整性校验
    if (!parsed || typeof parsed !== 'object') {
      console.warn('[Storage] 本地存储的流程图数据格式无效，重置为 null');
      return null;
    }

    const { nodes, edges } = parsed as Record<string, unknown>;

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      console.warn('[Storage] 本地存储的流程图节点或连线不是有效数组，重置为 null');
      return null;
    }

    return {
      nodes: nodes as FlowNode[],
      edges: edges as FlowEdge[],
    };
  } catch (error) {
    console.error('[Storage] 解析 localStorage 流程图数据失败:', error);
    return null;
  }
}

/**
 * 清空 localStorage 中的流程图数据
 */
export function clearDiagram(): void {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.removeItem(FS_DIAGRAM_STORAGE_KEY);
  } catch (error) {
    console.error('[Storage] 清空 localStorage 流程图数据失败:', error);
  }
}
