import { describe, it, expect } from 'vitest';
import { normalizeSpec } from '../src/spec/normalize.js';
import type { DiagramSpec } from '../src/spec/types.js';
import { renderTiered } from '../src/render/tiered.js';
import { renderTree } from '../src/render/tree.js';
import type { RenderContext } from '../src/render/types.js';
import { noOverlap, byId } from './helpers/render-asserts.js';

const threeTierSpec: DiagramSpec = {
  paradigm: 'tiered-dag',
  nodes: [
    { id: 'client', label: 'Web / App 客户端', type: 'io' },
    { id: 'lb', label: '反向代理 / Nginx 网关' },
    { id: 'app1', label: '应用节点 A', type: 'subprocess' },
    { id: 'app2', label: '应用节点 B', type: 'subprocess' },
    { id: 'redis', label: 'Redis 高性能缓存', type: 'database' },
    { id: 'db', label: 'PostgreSQL 主从集群', type: 'database' },
  ],
  edges: [
    { from: 'client', to: 'lb' },
    { from: 'lb', to: 'app1' },
    { from: 'lb', to: 'app2' },
    { from: 'app1', to: 'redis' },
    { from: 'app2', to: 'db' },
  ],
};

const orgSpec: DiagramSpec = {
  paradigm: 'tree',
  nodes: [
    { id: 'ceo', label: '总经理 / CEO' },
    { id: 'cto', label: '产研副总' },
    { id: 'cmo', label: '营销副总' },
    { id: 'coo', label: '运营总监' },
    { id: 'teamDev', label: '核心技术研发中心', type: 'subprocess' },
    { id: 'teamMkt', label: '品牌与商务拓展部', type: 'subprocess' },
    { id: 'root2', label: '独立顾问' },
  ],
  edges: [
    { from: 'ceo', to: 'cto', kind: 'tree' },
    { from: 'ceo', to: 'cmo', kind: 'tree' },
    { from: 'ceo', to: 'coo', kind: 'tree' },
    { from: 'cto', to: 'teamDev', kind: 'tree' },
    { from: 'cmo', to: 'teamMkt', kind: 'tree' },
  ],
};

const ctx: RenderContext = { idPrefix: '', origin: { x: 50, y: 50 }, fixed: new Map() };

describe('tiered-dag 几何约定', () => {
  it('同层同行且层内间距 TIER_GAP', () => {
    const r = renderTiered(normalizeSpec(threeTierSpec), ctx);
    const layer1 = r.nodes.filter((n) => ['app1', 'app2'].includes(n.id));
    expect(layer1[0].position.y).toBe(layer1[1].position.y);
    expect(layer1[1].position.x - (layer1[0].position.x + layer1[0].width!)).toBe(60);
    expect(noOverlap(r.nodes)).toBe(true);
  });

  it('层深按最长路径且层间净距 TIER_VGAP', () => {
    const r = renderTiered(normalizeSpec(threeTierSpec), ctx);
    const client = byId(r, 'client');
    const lb = byId(r, 'lb');
    const app1 = byId(r, 'app1');
    const redis = byId(r, 'redis');
    expect(lb.position.y - (client.position.y + client.height!)).toBe(60);
    expect(app1.position.y - (lb.position.y + lb.height!)).toBe(60);
    expect(redis.position.y - (app1.position.y + app1.height!)).toBe(60);
    expect(r.edges.every((e) => e.sourceHandle === 'bottom' && e.targetHandle === 'top')).toBe(true);
  });

  it('各层相对全图中心居中', () => {
    const r = renderTiered(normalizeSpec(threeTierSpec), ctx);
    const centers = [0, 1, 2, 3].map((layer) => {
      const row = r.nodes.filter((n) => layerOf(r, n.id) === layer);
      const left = Math.min(...row.map((n) => n.position.x));
      const right = Math.max(...row.map((n) => n.position.x + n.width!));
      return (left + right) / 2;
    });
    expect(new Set(centers.map((c) => Math.round(c))).size).toBe(1);
  });

  it('遇到有向环时不发生栈溢出并输出降级警告', () => {
    const cyclicSpec = {
      paradigm: 'tiered-dag' as const,
      lanes: [],
      nodes: [
        { id: 'a', label: 'A', role: 'main' as const },
        { id: 'b', label: 'B', role: 'main' as const },
      ],
      edges: [
        { from: 'a', to: 'b', kind: 'next' as const },
        { from: 'b', to: 'a', kind: 'next' as const },
      ],
      mainOrder: ['a', 'b'],
      warnings: [],
    };
    const r = renderTiered(cyclicSpec, ctx);
    expect(r.nodes.length).toBe(2);
    expect(r.warnings.some((w) => w.includes('环'))).toBe(true);
  });
});

function layerOf(r: ReturnType<typeof renderTiered>, id: string): number {
  const y = byId(r, id).position.y;
  const ys = [...new Set(r.nodes.map((n) => n.position.y))].sort((a, b) => a - b);
  return ys.indexOf(y);
}

describe('tree 几何约定', () => {
  it('父节点居中于子 span', () => {
    const r = renderTree(normalizeSpec(orgSpec), ctx);
    const cto = byId(r, 'cto');
    const kids = r.edges.filter((e) => e.data!.kind === 'tree' && e.source === 'cto').map((e) => byId(r, e.target));
    const left = Math.min(...kids.map((n) => n.position.x));
    const right = Math.max(...kids.map((n) => n.position.x + n.width!));
    expect(cto.position.x + cto.width! / 2).toBe((left + right) / 2);
    const ceo = byId(r, 'ceo');
    const ceoKids = r.edges.filter((e) => e.data!.kind === 'tree' && e.source === 'ceo').map((e) => byId(r, e.target));
    const cl = Math.min(...ceoKids.map((n) => n.position.x));
    const cr = Math.max(...ceoKids.map((n) => n.position.x + n.width!));
    expect(ceo.position.x + ceo.width! / 2).toBe((cl + cr) / 2);
  });

  it('多 root 水平并排且全图无重叠', () => {
    const r = renderTree(normalizeSpec(orgSpec), ctx);
    const root2 = byId(r, 'root2');
    const ceo = byId(r, 'ceo');
    expect(root2.position.y).toBe(ceo.position.y);
    expect(root2.position.x).toBeGreaterThan(ceo.position.x);
    expect(noOverlap(r.nodes)).toBe(true);
    expect(r.nodes.every((n) => n.parentId === undefined)).toBe(true);
  });

  it('深度按层递推 TREE_VGAP', () => {
    const r = renderTree(normalizeSpec(orgSpec), ctx);
    const cto = byId(r, 'cto');
    const team = byId(r, 'teamDev');
    expect(team.position.y - (cto.position.y + cto.height!)).toBe(60);
  });

  it('fixed 锁定节点保持原有 X/Y 坐标与尺寸不被行高覆写', () => {
    const fixedCtx: RenderContext = {
      idPrefix: '',
      origin: { x: 50, y: 50 },
      fixed: new Map([['cto', { position: { x: 420, y: 777 }, width: 180, height: 90 }]]),
      laneSizes: new Map(),
      obstacles: new Map(),
    };
    const r = renderTree(normalizeSpec(orgSpec), fixedCtx);
    const cto = byId(r, 'cto');
    expect(cto.position).toEqual({ x: 420, y: 777 });
    expect(cto.width).toBe(180);
    expect(cto.height).toBe(90);
  });

  it('支持纯直线路由、单边覆盖、多父共享汇聚节点居中与破环保留边', () => {
    const codeSpec: DiagramSpec = {
      paradigm: 'tree',
      edgeRouting: 'straight',
      nodes: [
        { id: 'entry', label: '入口', type: 'arch-gateway' },
        { id: 's1', label: '服务1' },
        { id: 's2', label: '服务2' },
        { id: 'db', label: '共享DB', type: 'database' },
        { id: 'note', label: '附注', attachTo: 's1' },
      ],
      edges: [
        { from: 'entry', to: 's1' },
        { from: 'entry', to: 's2', kind: 'branch', label: '分支' },
        { from: 's1', to: 'db' },
        { from: 's2', to: 'db' },
        { from: 's2', to: 'entry', routingType: 'orthogonal', label: '回环' },
      ],
    };
    const r = renderTree(normalizeSpec(codeSpec), ctx);
    expect(noOverlap(r.nodes)).toBe(true);
    expect(r.warnings.some((w) => w.includes('环'))).toBe(true);
    const db = byId(r, 'db');
    const s1 = byId(r, 's1');
    const s2 = byId(r, 's2');
    expect(db.position.y).toBeGreaterThan(s1.position.y + s1.height!);
    expect(db.position.x + db.width! / 2).toBeCloseTo(((s1.position.x + s1.width! / 2) + (s2.position.x + s2.width! / 2)) / 2, 0);
    const straightEdge = r.edges.find((e) => e.source === 'entry' && e.target === 's1')!;
    const overrideEdge = r.edges.find((e) => e.source === 's2' && e.target === 'entry')!;
    expect(straightEdge.type).toBe('straight');
    expect(straightEdge.data!.routingType).toBe('straight');
    expect(overrideEdge.type).toBe('orthogonal');
    expect(overrideEdge.sourceHandle).toBe('right');
    expect(overrideEdge.targetHandle).toBe('right');
  });
});