import { describe, it, expect } from 'vitest';
import { renderSpec } from '../src/render/index.js';
import { layoutCircuitFlowGraph } from '../src/render/circuit-flow-layout.js';
import { layoutTreeGraph } from '../src/render/tree-layout.js';
import type { DiagramSpec } from '../src/spec/types.js';
import { byId, noOverlap, buildYeepaySpec } from './helpers/render-asserts.js';

const cxOf = (n: { position: { x: number }; width?: number }) => Math.round(n.position.x + (n.width ?? 0) / 2);
const cyOf = (n: { position: { y: number }; height?: number }) => Math.round(n.position.y + (n.height ?? 0) / 2);

describe('circuit-flow 电路式控制流引擎与树状加固', () => {
  it('方式 A：单边守卫早退保持入口与出口共直线，早退侧翼同水平齐平且不回连', () => {
    const spec: DiagramSpec = {
      paradigm: 'circuit-flow',
      nodes: [
        { id: 'exit', label: '返回成功', type: 'start-end' },
        { id: 'err2', label: 'throw 余额不足', type: 'start-end' },
        { id: 'd2', label: '余额充足？', type: 'decision' },
        { id: 'err1', label: 'return 401 未授权', type: 'start-end' },
        { id: 'd1', label: '鉴权通过？', type: 'decision' },
        { id: 'entry', label: '请求入口', type: 'start-end' },
      ],
      edges: [
        { from: 'entry', to: 'd1' },
        { from: 'd1', to: 'err1', kind: 'branch', label: '否' },
        { from: 'd1', to: 'd2', label: '是' },
        { from: 'd2', to: 'err2', kind: 'branch', label: '否' },
        { from: 'd2', to: 'exit', label: '是' },
      ],
    };
    const r = renderSpec(spec);
    expect(noOverlap(r.nodes)).toBe(true);
    expect(r.nodes.every((n) => n.position.x >= 50 && n.position.y >= 50)).toBe(true);
    const entry = byId(r, 'entry');
    const d1 = byId(r, 'd1');
    const d2 = byId(r, 'd2');
    const exit = byId(r, 'exit');
    expect(new Set([cxOf(entry), cxOf(d1), cxOf(d2), cxOf(exit)]).size).toBe(1);
    const err1 = byId(r, 'err1');
    const err2 = byId(r, 'err2');
    expect(err1.position.y).toBe(d2.position.y);
    expect(err2.position.y).toBe(exit.position.y);
    expect(err1.position.x).toBeGreaterThan(d1.position.x + d1.width!);
    expect(err2.position.x).toBeGreaterThan(d2.position.x + d2.width!);
  });

  it('方式 A：平级多路分支起点水平齐平，嵌套含早退不破坏外层汇合点对齐最复杂分支底部', () => {
    const spec: DiagramSpec = {
      paradigm: 'circuit-flow',
      nodes: [
        { id: 'start', label: '入口', type: 'start-end' },
        { id: 'split', label: '策略分流', type: 'decision' },
        { id: 'fast', label: '快付直连' },
        { id: 'bank', label: '网银通道' },
        { id: 'check', label: '额度检查？', type: 'decision' },
        { id: 'fail', label: 'throw 超限异常', type: 'start-end', earlyExit: true },
        { id: 'book', label: '同步落库' },
        { id: 'merge', label: '结果汇总' },
        { id: 'end', label: '出口', type: 'start-end' },
      ],
      edges: [
        { from: 'start', to: 'split' },
        { from: 'split', to: 'fast', kind: 'branch', label: '快付' },
        { from: 'split', to: 'bank', kind: 'branch', label: '网银' },
        { from: 'fast', to: 'merge' },
        { from: 'bank', to: 'check' },
        { from: 'check', to: 'fail', kind: 'branch', label: '超限' },
        { from: 'check', to: 'book', label: '正常' },
        { from: 'book', to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
    };
    const r = renderSpec(spec);
    expect(noOverlap(r.nodes)).toBe(true);
    const start = byId(r, 'start');
    const split = byId(r, 'split');
    const merge = byId(r, 'merge');
    const end = byId(r, 'end');
    expect(new Set([cxOf(start), cxOf(split), cxOf(merge), cxOf(end)]).size).toBe(1);
    const fast = byId(r, 'fast');
    const bank = byId(r, 'bank');
    const book = byId(r, 'book');
    expect(fast.position.y).toBe(bank.position.y);
    expect(merge.position.y).toBeGreaterThanOrEqual(book.position.y + book.height! + 50);
  });

  it('非严格 SPG 子集共享节点零重叠且每节点仅落位一次', () => {
    const spec: DiagramSpec = {
      paradigm: 'circuit-flow',
      nodes: [
        { id: 's', label: '开始', type: 'start-end' },
        { id: 'd', label: '三路判断', type: 'decision' },
        { id: 'b1', label: '支路A' },
        { id: 'b2', label: '支路B' },
        { id: 'b3', label: '支路C' },
        { id: 'sub', label: 'A/B 共用兜底' },
        { id: 'e', label: '最终出口', type: 'start-end' },
      ],
      edges: [
        { from: 's', to: 'd' },
        { from: 'd', to: 'b1', kind: 'branch' },
        { from: 'd', to: 'b2', kind: 'branch' },
        { from: 'd', to: 'b3', kind: 'branch' },
        { from: 'b1', to: 'sub' },
        { from: 'b2', to: 'sub' },
        { from: 'sub', to: 'e' },
        { from: 'b3', to: 'e' },
      ],
    };
    const r = renderSpec(spec);
    expect(r.nodes.length).toBe(7);
    expect(noOverlap(r.nodes)).toBe(true);
    expect(cxOf(byId(r, 's'))).toBe(cxOf(byId(r, 'e')));
    const sub = byId(r, 'sub');
    expect(sub.position.y).toBeGreaterThan(byId(r, 'b1').position.y);
    expect(byId(r, 'e').position.y).toBeGreaterThan(sub.position.y + sub.height!);
  });

  it('横向 LR 对称转置保持入口出口同水平中心线且无重叠', () => {
    const spec: DiagramSpec = {
      paradigm: 'circuit-flow',
      orientation: 'horizontal',
      nodes: [
        { id: 's', label: '输入', type: 'start-end' },
        { id: 'd', label: '模式', type: 'decision' },
        { id: 'a', label: '支路1' },
        { id: 'b', label: '支路2' },
        { id: 'm', label: '汇聚' },
        { id: 'e', label: '输出', type: 'start-end' },
      ],
      edges: [
        { from: 's', to: 'd' },
        { from: 'd', to: 'a', kind: 'branch', label: '1' },
        { from: 'd', to: 'b', kind: 'branch', label: '2' },
        { from: 'a', to: 'm' },
        { from: 'b', to: 'm' },
        { from: 'm', to: 'e' },
      ],
    };
    const r = renderSpec(spec);
    expect(noOverlap(r.nodes)).toBe(true);
    expect(new Set([cyOf(byId(r, 's')), cyOf(byId(r, 'd')), cyOf(byId(r, 'm')), cyOf(byId(r, 'e'))]).size).toBe(1);
    expect(byId(r, 'a').position.x).toBe(byId(r, 'b').position.x);
    expect(byId(r, 'm').position.x).toBeGreaterThan(byId(r, 'a').position.x + byId(r, 'a').width!);
    const fwd = r.edges.find((edge) => edge.source === 's' && edge.target === 'd')!;
    expect(fwd.sourceHandle).toMatch(/^right(@|$)/);
    expect(fwd.targetHandle).toMatch(/^left(@|$)/);
  });

  it('纯直线模式下早退外置、短支路居内防穿切且 loop/共轴 jump 自动保正交通道', () => {
    const spec: DiagramSpec = {
      paradigm: 'circuit-flow',
      edgeRouting: 'straight',
      nodes: [
        { id: 's', label: '入口', type: 'start-end' },
        { id: 'd', label: '分支', type: 'decision' },
        { id: 'short', label: '短分支' },
        { id: 'long1', label: '长分支1' },
        { id: 'long2', label: '长分支2' },
        { id: 'err', label: 'throw 错误', type: 'start-end', earlyExit: true },
        { id: 'm', label: '汇合节点' },
        { id: 'e', label: '出口', type: 'start-end' },
      ],
      edges: [
        { from: 's', to: 'd' },
        { from: 'd', to: 'long1', kind: 'branch', label: '长' },
        { from: 'd', to: 'short', kind: 'branch', label: '短' },
        { from: 'd', to: 'err', kind: 'branch', label: '异常' },
        { from: 'long1', to: 'long2' },
        { from: 'long2', to: 'm' },
        { from: 'short', to: 'm' },
        { from: 'm', to: 'd', kind: 'loop', label: '重试' },
        { from: 'm', to: 'e' },
        { from: 's', to: 'e', kind: 'jump', label: '直跳' },
      ],
    };
    const r = renderSpec(spec);
    expect(noOverlap(r.nodes)).toBe(true);
    const shortN = byId(r, 'short');
    const long1N = byId(r, 'long1');
    const errN = byId(r, 'err');
    const mergeN = byId(r, 'm');
    expect(Math.abs(cxOf(shortN) - cxOf(mergeN))).toBeLessThan(Math.abs(cxOf(long1N) - cxOf(mergeN)));
    expect(errN.position.x).toBeGreaterThan(Math.max(shortN.position.x, long1N.position.x));
    const loopEdge = r.edges.find((ed) => ed.data?.kind === 'loop')!;
    const jumpEdge = r.edges.find((ed) => ed.data?.kind === 'jump')!;
    const straightEdge = r.edges.find((ed) => ed.source === 'short' && ed.target === 'm')!;
    expect(loopEdge.type).toBe('orthogonal');
    expect(jumpEdge.type).toBe('orthogonal');
    expect(straightEdge.type).toBe('straight');
  });

  it('乱序复杂真实流程（fmmpay 渠道出金链路 & buildYeepaySpec）零重叠零负坐标且正向不逆流', () => {
    const fmmpay: DiagramSpec = {
      paradigm: 'circuit-flow',
      nodes: [
        { id: 'end_succ', label: '出金成功返回', type: 'start-end' },
        { id: 'ret_risk', label: 'return 风控拦截', type: 'start-end' },
        { id: 'n_split', label: '路由模式判断', type: 'decision' },
        { id: 'n_api_1', label: '组装渠道报文' },
        { id: 'n_api_2', label: '签名发起 HTTP' },
        { id: 'n_batch', label: '写入银企直连批处理' },
        { id: 'n_shared_fail', label: '统一异常登记' },
        { id: 'n_callback', label: '等待异步回调' },
        { id: 'n_entry', label: '代付请求入口', type: 'start-end' },
        { id: 'n_note', label: '资金出金核心路由说明', attachTo: 'n_split' },
      ],
      edges: [
        { from: 'n_entry', to: 'n_split' },
        { from: 'n_split', to: 'ret_risk', kind: 'branch', label: '风控拒绝' },
        { from: 'n_split', to: 'n_api_1', kind: 'branch', label: 'API 直连' },
        { from: 'n_split', to: 'n_batch', kind: 'branch', label: '网银批量' },
        { from: 'n_api_1', to: 'n_api_2' },
        { from: 'n_api_2', to: 'n_shared_fail', kind: 'branch', label: '通道失败' },
        { from: 'n_batch', to: 'n_shared_fail', kind: 'branch', label: '打批失败' },
        { from: 'n_shared_fail', to: 'n_callback' },
        { from: 'n_api_2', to: 'n_callback', label: '受理' },
        { from: 'n_batch', to: 'n_callback', label: '受理' },
        { from: 'n_callback', to: 'end_succ' },
      ],
    };
    const r = renderSpec(fmmpay);
    expect(noOverlap(r.nodes)).toBe(true);
    expect(r.nodes.every((n) => n.position.x >= 50 && n.position.y >= 50)).toBe(true);
    expect(cxOf(byId(r, 'n_entry'))).toBe(cxOf(byId(r, 'end_succ')));

    const yeepay = renderSpec(buildYeepaySpec());
    expect(yeepay.nodes.length).toBe(48);
    expect(noOverlap(yeepay.nodes)).toBe(true);
    expect(yeepay.nodes.every((n) => n.position.x >= 50 && n.position.y >= 50)).toBe(true);
  });

  it('fixed 锁节点保留坐标且其余节点避让，不发生重叠', () => {
    const res = layoutCircuitFlowGraph(
      [
        { id: 'a', width: 160, height: 80, type: 'start-end' },
        { id: 'b', width: 160, height: 80, fixed: { position: { x: 50, y: 50 }, width: 160, height: 80 } },
        { id: 'c', width: 160, height: 80, type: 'start-end' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    );
    expect(res.positions.get('b')).toEqual({ x: 50, y: 50, width: 160, height: 80 });
    const list = [...res.positions.entries()].map(([id, box]) => ({
      id,
      type: 'process' as const,
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: { label: id, type: 'process' as const },
    }));
    expect(noOverlap(list)).toBe(true);
  });

  it('tree-layout 加固：入口优先破环、fixed 锁节点不撞穿、多父汇聚与附注左置防掉底', () => {
    const res = layoutTreeGraph(
      [
        { id: 'tail', width: 160, height: 80 },
        { id: 'mid1', width: 160, height: 80, fixed: { position: { x: 250, y: 190 }, width: 160, height: 80 } },
        { id: 'mid2', width: 160, height: 80 },
        { id: 'entry', width: 160, height: 80, type: 'start-end', label: '请求入口' } as any,
        { id: 'note', width: 200, height: 120, role: 'annotation', attachTo: 'mid1' },
      ],
      [
        { from: 'entry', to: 'mid1' },
        { from: 'entry', to: 'mid2' },
        { from: 'mid1', to: 'tail' },
        { from: 'mid2', to: 'tail' },
        { from: 'tail', to: 'entry' },
      ],
    );
    expect(res.depths.get('entry')).toBe(0);
    expect(res.positions.get('mid1')).toEqual({ x: 250, y: 190, width: 160, height: 80 });
    const nodes = [...res.positions.entries()].map(([id, box]) => ({
      id,
      type: 'process' as const,
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: { label: id, type: 'process' as const },
    }));
    expect(noOverlap(nodes)).toBe(true);
  });
});
