import { describe, it, expect } from 'vitest';
import { type FlowEdge, type FlowNode } from '@flowstudio/shared';
import { layoutDiagram } from '../../src/features/canvas/layout/elk-layout';
import { EdgeRoutingManager } from '../../src/features/canvas/custom-edges/edge-routing-manager';

describe('前端电路流排版与自身泳道豁免路由', () => {
  it('layoutDiagram(mode=circuit) 支持纵向与横向并保留纯直线边不误洗', async () => {
    const nodes: FlowNode[] = [
      { id: 's', type: 'start-end', position: { x: 400, y: 10 }, width: 140, height: 50, data: { label: '入口', type: 'start-end' } },
      { id: 'd', type: 'decision', position: { x: 10, y: 400 }, width: 140, height: 80, data: { label: '分流', type: 'decision' } },
      { id: 'a', type: 'process', position: { x: 80, y: 80 }, width: 160, height: 80, data: { label: '支路A', type: 'process' } },
      { id: 'b', type: 'process', position: { x: 600, y: 80 }, width: 160, height: 80, data: { label: '支路B', type: 'process' } },
      { id: 'e', type: 'start-end', position: { x: 90, y: 90 }, width: 140, height: 50, data: { label: '出口', type: 'start-end' } },
    ];
    const edges: FlowEdge[] = [
      { id: 'e1', source: 's', target: 'd', type: 'straight', data: { routingType: 'straight' } },
      { id: 'e2', source: 'd', target: 'a', type: 'straight', data: { kind: 'branch', routingType: 'straight' } },
      { id: 'e3', source: 'd', target: 'b', type: 'straight', data: { kind: 'branch', routingType: 'straight' } },
      { id: 'e4', source: 'a', target: 'e', type: 'straight', data: { routingType: 'straight' } },
      { id: 'e5', source: 'b', target: 'e', type: 'straight', data: { routingType: 'straight' } },
    ];

    const down = await layoutDiagram(nodes, edges, { mode: 'circuit', direction: 'DOWN' });
    const sd = down.nodes.find((n) => n.id === 's')!;
    const ed = down.nodes.find((n) => n.id === 'e')!;
    expect(Math.round(sd.position.x + sd.width! / 2)).toBe(Math.round(ed.position.x + ed.width! / 2));
    expect(ed.position.y).toBeGreaterThan(sd.position.y);
    expect(down.edges.every((edge) => edge.type === 'straight' && !edge.data?.waypoints)).toBe(true);

    const right = await layoutDiagram(nodes, edges, { mode: 'circuit', direction: 'RIGHT' });
    const sr = right.nodes.find((n) => n.id === 's')!;
    const er = right.nodes.find((n) => n.id === 'e')!;
    expect(Math.round(sr.position.y + sr.height! / 2)).toBe(Math.round(er.position.y + er.height! / 2));
    expect(er.position.x).toBeGreaterThan(sr.position.x);
  });

  it('EdgeRoutingManager 对同泳道内部连线豁免自身泳道惩罚', () => {
    const manager = new EdgeRoutingManager();
    manager.updateNodes([
      { id: 'pool', type: 'pool', position: { x: 0, y: 0 }, width: 800, height: 300, data: { label: '池', type: 'pool' } },
      { id: 'lane1', type: 'lane', parentId: 'pool', position: { x: 0, y: 40 }, width: 800, height: 260, data: { label: '道', type: 'lane' } },
      { id: 'n1', type: 'process', parentId: 'lane1', position: { x: 60, y: 60 }, width: 160, height: 80, data: { label: '1', type: 'process' } },
      { id: 'n2', type: 'process', parentId: 'lane1', position: { x: 320, y: 60 }, width: 160, height: 80, data: { label: '2', type: 'process' } },
    ]);
    const res = manager.routeEdge({
      id: 'e-in-lane',
      source: { x: 220, y: 140 },
      target: { x: 320, y: 140 },
      sourcePosition: 'right',
      targetPosition: 'left',
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
    });
    expect(res.path).toContain('M 220 140');
    expect(res.waypoints.every((p) => p.y >= 40 && p.y <= 300)).toBe(true);
  });
});
