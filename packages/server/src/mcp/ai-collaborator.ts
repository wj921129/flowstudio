/**
 * @fileoverview AI 协作者引擎 (AI Collaborator)
 * @description 代表 AI 协作者连接并操作 Y.Doc，负责 MCP 工具落地、局部排版、事务原子化与前置自动快照
 */

import * as Y from 'yjs';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { CompactDiagram, McpOp } from './types.js';

const elkInstance = new ELK();

export class AiCollaborator {
  constructor(
    private repo: DiagramRepository,
    private serverBaseUrl: string = 'http://127.0.0.1:3000'
  ) {}

  /**
   * 1. list_diagrams
   */
  async listDiagrams() {
    const list = this.repo.listDiagrams();
    return list.map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: d.updatedAt,
      url: `${this.serverBaseUrl}/#${d.id}`,
    }));
  }

  /**
   * 2. create_diagram
   */
  async createDiagram(title: string) {
    const summary = this.repo.createDiagram({ title: title || '未命名流程图' });
    return {
      id: summary.id,
      title: summary.title,
      url: `${this.serverBaseUrl}/#${summary.id}`,
    };
  }

  /**
   * 3. get_diagram
   */
  async getDiagram(diagramId: string): Promise<CompactDiagram | null> {
    const rawState = this.repo.getYDocState(diagramId);
    if (!rawState) return null;

    const doc = new Y.Doc();
    Y.applyUpdate(doc, rawState);

    const title = (doc.getMap('meta').get('title') as string) || '未命名流程图';
    const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
    const edgesMap = doc.getMap<Y.Map<unknown>>('edges');

    const lanes: Array<{ id: string; label: string }> = [];
    const nodes: CompactDiagram['nodes'] = [];
    const edges: CompactDiagram['edges'] = [];

    nodesMap.forEach((nodeMap, id) => {
      const type = (nodeMap.get('type') as string) || 'process';
      const pos = (nodeMap.get('position') as { x: number; y: number }) || { x: 0, y: 0 };
      const data = (nodeMap.get('data') as Record<string, unknown>) || {};
      const parentId = nodeMap.get('parentId') as string | undefined;
      const label = (data.label as string) || (data.laneTitle as string) || id;

      if (type === 'lane') {
        lanes.push({ id, label });
      } else if (type !== 'pool') {
        nodes.push({
          id,
          type,
          label,
          laneId: parentId,
          position: pos,
        });
      }
    });

    edgesMap.forEach((edgeMap, id) => {
      const source = edgeMap.get('source') as string;
      const target = edgeMap.get('target') as string;
      const data = (edgeMap.get('data') as Record<string, unknown>) || {};
      const label = (data.label as string) || undefined;
      if (source && target) {
        edges.push({ id, source, target, label });
      }
    });

    return {
      id: diagramId,
      title,
      lanes,
      nodes,
      edges,
    };
  }

  /**
   * 4. get_selection
   */
  async getSelection(diagramId: string, _nickname?: string) {
    // 若当前无在线用户，返回说明
    return {
      diagramId,
      selections: [],
      message: '当前无在线同事选中节点',
    };
  }

  /**
   * 5. scaffold_diagram
   */
  async scaffoldDiagram(input: {
    diagramId: string;
    title?: string;
    lanes?: Array<{ id: string; label: string }>;
    nodes: Array<{ id: string; type: string; label: string; laneId?: string }>;
    edges: Array<{ source: string; target: string; label?: string }>;
  }) {
    const rawState = this.repo.getYDocState(input.diagramId);
    if (!rawState) {
      throw new Error(`图表 ${input.diagramId} 不存在`);
    }

    // AI 批次前自动快照
    this.repo.createSnapshot(input.diagramId, 'AI 生成骨架前快照', 'ai_batch');

    const doc = new Y.Doc();
    Y.applyUpdate(doc, rawState);

    const hasLanes = input.lanes && input.lanes.length > 0;
    const poolId = hasLanes ? `pool-${Date.now().toString(36)}` : undefined;

    // 服务端调用 ELK 计算坐标
    const elkChildren = input.nodes.map((n) => ({
      id: n.id,
      width: 160,
      height: 80,
    }));
    const elkEdges = input.edges.map((e, idx) => ({
      id: `e-${idx}`,
      sources: [e.source],
      targets: [e.target],
    }));

    const layoutResult = await elkInstance.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      },
      children: elkChildren,
      edges: elkEdges,
    });

    const posMap = new Map<string, { x: number; y: number }>();
    if (layoutResult.children) {
      for (const c of layoutResult.children) {
        posMap.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
      }
    }

    doc.transact(() => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
      const metaMap = doc.getMap<unknown>('meta');

      if (input.title) {
        metaMap.set('title', input.title.trim());
      }

      nodesMap.clear();
      edgesMap.clear();

      if (hasLanes && poolId) {
        // 创建 Pool
        const poolMap = new Y.Map<unknown>();
        poolMap.set('id', poolId);
        poolMap.set('type', 'pool');
        poolMap.set('position', { x: 50, y: 50 });
        poolMap.set('width', 900);
        poolMap.set('height', 40 + input.lanes!.length * 200);
        poolMap.set('data', {
          label: input.title || '业务泳道池',
          type: 'pool',
          orientation: 'horizontal',
          laneOrder: input.lanes!.map((l) => l.id),
          headerSize: 40,
        });
        nodesMap.set(poolId, poolMap);

        // 创建 Lanes
        input.lanes!.forEach((l, idx) => {
          const laneMap = new Y.Map<unknown>();
          laneMap.set('id', l.id);
          laneMap.set('type', 'lane');
          laneMap.set('parentId', poolId);
          laneMap.set('extent', 'parent');
          laneMap.set('position', { x: 0, y: 40 + idx * 200 });
          laneMap.set('width', 900);
          laneMap.set('height', 200);
          laneMap.set('data', { label: l.label, type: 'lane', laneTitle: l.label });
          nodesMap.set(l.id, laneMap);
        });
      }

      // 创建节点
      for (const n of input.nodes) {
        const nodeMap = new Y.Map<unknown>();
        const pos = posMap.get(n.id) ?? { x: 50, y: 50 };
        nodeMap.set('id', n.id);
        nodeMap.set('type', n.type || 'process');
        nodeMap.set('position', pos);
        nodeMap.set('width', 160);
        nodeMap.set('height', 80);
        if (n.laneId) {
          nodeMap.set('parentId', n.laneId);
          nodeMap.set('extent', 'parent');
        }
        nodeMap.set('data', { label: n.label, type: n.type || 'process' });
        nodesMap.set(n.id, nodeMap);
      }

      // 创建连线
      input.edges.forEach((e, idx) => {
        const edgeId = `edge-${Date.now().toString(36)}-${idx}`;
        const edgeMap = new Y.Map<unknown>();
        edgeMap.set('id', edgeId);
        edgeMap.set('source', e.source);
        edgeMap.set('target', e.target);
        edgeMap.set('type', 'orthogonal');
        edgeMap.set('data', { label: e.label });
        edgesMap.set(edgeId, edgeMap);
      });
    }, 'ai-scaffold');

    this.repo.saveYDocState(
      input.diagramId,
      Y.encodeStateAsUpdate(doc),
      input.title
    );

    return {
      success: true,
      message: `已成功生成包含 ${input.nodes.length} 个节点、${input.edges.length} 条连线的骨架`,
      url: `${this.serverBaseUrl}/#${input.diagramId}`,
    };
  }

  /**
   * 6. apply_ops
   */
  async applyOps(input: { diagramId: string; ops: McpOp[] }) {
    const rawState = this.repo.getYDocState(input.diagramId);
    if (!rawState) {
      throw new Error(`图表 ${input.diagramId} 不存在`);
    }

    // AI 批次前自动快照
    this.repo.createSnapshot(input.diagramId, 'AI 增量修改前快照', 'ai_batch');

    const doc = new Y.Doc();
    Y.applyUpdate(doc, rawState);

    const warnings: string[] = [];
    let appliedCount = 0;

    doc.transact(() => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');

      for (const op of input.ops) {
        switch (op.op) {
          case 'add_node': {
            const nodeId = op.id || `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            const nodeMap = new Y.Map<unknown>();
            nodeMap.set('id', nodeId);
            nodeMap.set('type', op.type || 'process');
            nodeMap.set('position', { x: 100 + appliedCount * 180, y: 100 });
            nodeMap.set('width', 160);
            nodeMap.set('height', 80);
            if (op.laneId) {
              nodeMap.set('parentId', op.laneId);
              nodeMap.set('extent', 'parent');
            }
            nodeMap.set('data', { label: op.label, type: op.type || 'process', ...(op.style ? { style: op.style } : {}) });
            nodesMap.set(nodeId, nodeMap);
            appliedCount++;
            break;
          }

          case 'update_node': {
            const nodeMap = nodesMap.get(op.id);
            if (!nodeMap) {
              warnings.push(`未找到节点 ${op.id}，跳过更新`);
              break;
            }
            const data = (nodeMap.get('data') as Record<string, unknown>) || {};
            const nextData = { ...data };
            if (op.label) nextData.label = op.label;
            if (op.style) nextData.style = { ...((nextData.style as object) || {}), ...op.style };
            nodeMap.set('data', nextData);
            appliedCount++;
            break;
          }

          case 'delete_node': {
            if (!nodesMap.has(op.id)) {
              warnings.push(`未找到节点 ${op.id}，跳过删除`);
              break;
            }
            nodesMap.delete(op.id);
            // 级联删除连线
            const edgeKeys = Array.from(edgesMap.keys());
            for (const ek of edgeKeys) {
              const em = edgesMap.get(ek);
              if (em && (em.get('source') === op.id || em.get('target') === op.id)) {
                edgesMap.delete(ek);
              }
            }
            appliedCount++;
            break;
          }

          case 'connect': {
            if (!nodesMap.has(op.source) || !nodesMap.has(op.target)) {
              warnings.push(`连线端点不存在 (${op.source} -> ${op.target})，跳过`);
              break;
            }
            const edgeId = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            const edgeMap = new Y.Map<unknown>();
            edgeMap.set('id', edgeId);
            edgeMap.set('source', op.source);
            edgeMap.set('target', op.target);
            edgeMap.set('type', 'orthogonal');
            edgeMap.set('data', { label: op.label, ...(op.style ? { style: op.style } : {}) });
            edgesMap.set(edgeId, edgeMap);
            appliedCount++;
            break;
          }

          case 'disconnect': {
            if (op.edgeId) {
              edgesMap.delete(op.edgeId);
              appliedCount++;
            } else if (op.source && op.target) {
              const edgeKeys = Array.from(edgesMap.keys());
              for (const ek of edgeKeys) {
                const em = edgesMap.get(ek);
                if (em && em.get('source') === op.source && em.get('target') === op.target) {
                  edgesMap.delete(ek);
                  appliedCount++;
                }
              }
            }
            break;
          }

          case 'move_to_lane': {
            const nodeMap = nodesMap.get(op.nodeId);
            if (!nodeMap) {
              warnings.push(`未找到节点 ${op.nodeId}，跳过移入泳道`);
              break;
            }
            nodeMap.set('parentId', op.laneId);
            nodeMap.set('extent', 'parent');
            appliedCount++;
            break;
          }
        }
      }
    }, 'ai-apply-ops');

    this.repo.saveYDocState(input.diagramId, Y.encodeStateAsUpdate(doc));

    return {
      success: true,
      appliedCount,
      totalOps: input.ops.length,
      warnings,
    };
  }

  /**
   * 7. auto_layout
   */
  async autoLayout(input: { diagramId: string; direction?: 'RIGHT' | 'DOWN' }) {
    const rawState = this.repo.getYDocState(input.diagramId);
    if (!rawState) throw new Error(`图表 ${input.diagramId} 不存在`);

    this.repo.createSnapshot(input.diagramId, '服务端自动排版前快照', 'manual');

    const doc = new Y.Doc();
    Y.applyUpdate(doc, rawState);

    const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
    const edgesMap = doc.getMap<Y.Map<unknown>>('edges');

    const elkChildren: any[] = [];
    nodesMap.forEach((nm, id) => {
      const type = nm.get('type') as string;
      if (type !== 'pool' && type !== 'lane') {
        elkChildren.push({ id, width: 160, height: 80 });
      }
    });

    const elkEdges: any[] = [];
    edgesMap.forEach((em, id) => {
      const source = em.get('source') as string;
      const target = em.get('target') as string;
      if (source && target) {
        elkEdges.push({ id, sources: [source], targets: [target] });
      }
    });

    const layoutRes = await elkInstance.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': input.direction || 'RIGHT',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      },
      children: elkChildren,
      edges: elkEdges,
    });

    doc.transact(() => {
      if (layoutRes.children) {
        for (const c of layoutRes.children) {
          const nm = nodesMap.get(c.id);
          if (nm) {
            nm.set('position', { x: c.x ?? 0, y: c.y ?? 0 });
          }
        }
      }
    }, 'ai-auto-layout');

    this.repo.saveYDocState(input.diagramId, Y.encodeStateAsUpdate(doc));

    return { success: true, message: '服务端排版完成' };
  }
}
