import type { FlowNode } from '../../src/types.js';
import type { RenderResult } from '../../src/render/types.js';

export function noOverlap(nodes: FlowNode[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const aw = a.width ?? 0;
      const ah = a.height ?? 0;
      const bw = b.width ?? 0;
      const bh = b.height ?? 0;
      if (a.position.x < b.position.x + bw && b.position.x < a.position.x + aw && a.position.y < b.position.y + bh && b.position.y < a.position.y + ah) return false;
    }
  }
  return true;
}

export function byId(r: RenderResult, id: string): FlowNode {
  const n = r.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`渲染结果缺少节点 ${id}`);
  return n;
}