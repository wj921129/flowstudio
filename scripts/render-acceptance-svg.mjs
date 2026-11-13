import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANCH_GAP, DIAGRAM_PRESETS, MAIN_GAP, REG_LANE, REG_LANE_STEP, REG_STUB, normalizeSpec, renderSpec } from '../packages/shared/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.work', 'flow', 'assets');
mkdirSync(outDir, { recursive: true });
const EPS = 1e-6;
const preset = (id) => { const p = DIAGRAM_PRESETS.find((x) => x.id === id); if (!p) throw new Error(`缺少预设 ${id}`); return p; };
const dualSpec = {
  paradigm: 'vertical-flow', title: '双重判断回归验收样例',
  nodes: [
    { id: 'm1', label: '入口', type: 'start-end' },
    { id: 'd1', label: '员工薪酬？', type: 'decision' },
    { id: 'b1', label: '薪酬>30万？', type: 'decision' },
    { id: 'pass', label: '不限额·通过', type: 'start-end' },
    { id: 'limit', label: '限额', type: 'start-end' },
    { id: 'm2', label: '大陆公司？', type: 'decision' },
    { id: 'note', label: '双重判断：通过结果 loop 回归源主干', type: 'comment', attachTo: 'm1' },
  ],
  edges: [
    { from: 'm1', to: 'd1' },
    { from: 'd1', to: 'm2', label: '否' },
    { from: 'd1', to: 'b1', kind: 'branch', label: '是' },
    { from: 'b1', to: 'pass', label: '否' },
    { from: 'b1', to: 'limit', kind: 'branch', label: '是' },
    { from: 'pass', to: 'd1', kind: 'loop', label: '回归' },
  ],
};
const cases = [
  { name: 'flowchart-approval', title: preset('flowchart-approval').title, spec: preset('flowchart-approval').spec },
  { name: 'flowchart-retry-compensation', title: preset('flowchart-retry-compensation').title, spec: preset('flowchart-retry-compensation').spec },
  { name: 'dual-decision-regression', title: dualSpec.title, spec: dualSpec },
];
const midY = (n) => n.position.y + n.height / 2;
const right = (n) => n.position.x + n.width;
const bottom = (n) => n.position.y + n.height;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function assertCase(name, spec) {
  const n = normalizeSpec(spec);
  const r = renderSpec(spec);
  const node = (id) => { const x = r.nodes.find((v) => v.id === id); if (!x) throw new Error(`${name} 渲染缺少节点 ${id}`); return x; };
  const byId = new Map(n.nodes.map((x) => [x.id, x]));
  const anchor = (id) => { let cur = id; const seen = new Set(); while (!seen.has(cur)) { seen.add(cur); if (byId.get(cur).role === 'main') return cur; const inc = n.edges.find((e) => (e.kind === 'branch' || e.kind === 'next') && e.to === cur); if (!inc) return cur; cur = inc.from; } return cur; };
  const mains = n.mainOrder.map(node);
  const trunkRight = Math.max(...mains.map(right));
  const checks = [];
  const add = (g, ok, detail) => checks.push({ g, ok, detail });
  const anns = r.nodes.filter((x) => x.data.role === 'annotation');
  const g1bad = [];
  for (const a of anns) { const h = node(a.data.attachTo); if (!(a.position.x + a.width < h.position.x - EPS)) g1bad.push(`${a.id}未左置`); }
  for (const e of r.edges.filter((x) => x.data.kind === 'annotate')) if (e.sourceHandle !== 'left' || e.targetHandle !== 'right') g1bad.push(`${e.id}桩向`);
  add('G1', g1bad.length === 0, `附注${anns.length}个 note.x+width<宿主.x，annotate 左出右入${g1bad.length ? `；违规:${g1bad.join(',')}` : ''}`);
  const g2bad = []; let term = 0, cont = 0;
  for (const e of n.edges.filter((x) => x.kind === 'branch')) {
    const s = node(e.from), t = node(e.to);
    if (!(t.position.x > right(s) + EPS)) g2bad.push(`${e.to}未右置`);
    if (t.type === 'start-end') {
      const sibs = n.edges.filter((x) => x.kind === 'next' && x.from === e.from).map((x) => node(x.to));
      if (sibs.length === 0) g2bad.push(`${e.to}缺 next 同行参照`);
      for (const sib of sibs) { term++; if (Math.abs(t.position.y - sib.position.y) > EPS || !(t.position.x > right(sib) + EPS)) g2bad.push(`${e.to}与${sib.id}未同行右置`); }
    } else {
      cont++;
      if (Math.abs(midY(t) - midY(s)) > EPS) g2bad.push(`${e.to}未与源同行`);
      if (byId.get(e.from).role === 'main' && !(t.position.x >= right(s) + BRANCH_GAP - EPS)) g2bad.push(`${e.to}块左界<源右缘+${BRANCH_GAP}`);
    }
  }
  add('G2', g2bad.length === 0, `终端分支与 next 子同行右置${term}对，继续型同行占新列${cont}个${g2bad.length ? `；违规:${g2bad.join(',')}` : ''}`);
  const g3bad = []; const g3d = [];
  n.mainOrder.forEach((id, i) => {
    const members = n.nodes.filter((x) => x.role === 'branch' && anchor(x.id) === id);
    if (members.length === 0) return;
    const bb = Math.max(...members.map((x) => bottom(node(x.id))));
    const nextId = n.mainOrder[i + 1];
    if (!nextId) { g3d.push(`${id} 分支块底${bb}，无后续主干`); return; }
    const ny = node(nextId).position.y;
    g3d.push(`${nextId}.y=${ny} ≥ ${id}块底${bb}+MAIN_GAP(${MAIN_GAP})`);
    if (!(ny >= bb + MAIN_GAP - EPS)) g3bad.push(nextId);
  });
  add('G3', g3bad.length === 0, g3d.join('；') || '无分支块');
  const regs = r.edges.filter((e) => e.data.kind === 'loop' && node(e.source).data.role === 'branch' && node(e.target).data.role === 'main' && anchor(e.source) === e.target);
  const g4bad = [];
  regs.forEach((e, idx) => {
    const wp = e.data.waypoints ?? [];
    const laneX = trunkRight + REG_LANE + idx * REG_LANE_STEP;
    if (e.sourceHandle !== 'left' || e.targetHandle !== 'right') g4bad.push(`${e.id}桩向`);
    if (wp.length !== 4 || !wp.every((p) => p.x > trunkRight + EPS)) g4bad.push(`${e.id}waypoints越界`);
    if (wp.length === 4 && (Math.abs(wp[0].x - laneX) > EPS || Math.abs(wp[1].x - laneX) > EPS || Math.abs(wp[2].x - trunkRight - REG_STUB) > EPS || Math.abs(wp[3].x - trunkRight - REG_STUB) > EPS)) g4bad.push(`${e.id}lane公式`);
  });
  const loops = r.edges.filter((e) => e.data.kind === 'loop');
  const g5 = loops.filter((e) => !regs.includes(e));
  add('G4', g4bad.length === 0, regs.length > 0 ? `回归边${regs.length}条 left→right，独立lane=trunkRight(${trunkRight})+${REG_LANE}+idx*${REG_LANE_STEP}，waypoints 全在主干右${g4bad.length ? `；违规:${g4bad.join(',')}` : ''}` : `无锚点回归边，G4 空真${g5.length > 0 ? `；${g5.length}条 loop 属 G5 重试回环(${g5.map((e) => `${e.sourceHandle}→${e.targetHandle}`).join(',')})` : ''}`);
  const overlaps = [];
  for (let i = 0; i < r.nodes.length; i++) for (let j = i + 1; j < r.nodes.length; j++) { const a = r.nodes[i], b = r.nodes[j]; if (a.position.x < right(b) && b.position.x < right(a) && a.position.y < bottom(b) && b.position.y < bottom(a)) overlaps.push(`${a.id}×${b.id}`); }
  const noHandle = r.edges.filter((e) => !e.sourceHandle || !e.targetHandle).map((e) => e.id);
  add('G6', overlaps.length === 0 && noHandle.length === 0, `noOverlap(${r.nodes.length}节点)${overlaps.length ? `，重叠:${overlaps.join(',')}` : ''}；${r.edges.length}边全显式连接桩${noHandle.length ? `，缺桩:${noHandle.join(',')}` : ''}`);
  return { name, n, r, checks, trunkRight, warnings: r.warnings };
}

const NODE_STYLE = {
  'start-end': { fill: '#e6f6ec', stroke: '#2f9e63', text: '#1c5c3a', rx: 26 },
  decision: { fill: '#fdf1dc', stroke: '#d99a2b', text: '#7a5410', rx: 6 },
  process: { fill: '#e9f0fb', stroke: '#4a7dc9', text: '#274b80', rx: 8 },
  comment: { fill: '#fbf6df', stroke: '#c9b458', text: '#6d5f1e', rx: 4 },
};
const EDGE_COLOR = { next: '#5b6b7f', branch: '#d99a2b', loop: '#c65353', annotate: '#9aa7b5', jump: '#4a9dc9' };
const KIND_LABEL = { next: 'next 主干', branch: 'branch 分支', loop: 'loop 回归', annotate: 'annotate 附注', jump: 'jump 跳转' };
const HANDLE = { left: (n) => [n.position.x, midY(n)], right: (n) => [right(n), midY(n)], top: (n) => [n.position.x + n.width / 2, n.position.y], bottom: (n) => [n.position.x + n.width / 2, bottom(n)] };

function edgePoints(e, map) {
  const sp = HANDLE[e.sourceHandle](map.get(e.source)), tp = HANDLE[e.targetHandle](map.get(e.target));
  const wp = (e.data.waypoints ?? []).map((p) => [p.x, p.y]);
  if (wp.length > 0) return [sp, ...wp, tp];
  const sv = e.sourceHandle === 'top' || e.sourceHandle === 'bottom', tv = e.targetHandle === 'top' || e.targetHandle === 'bottom';
  if (sv && tv) { const my = (sp[1] + tp[1]) / 2; return [sp, [sp[0], my], [tp[0], my], tp]; }
  if (!sv && !tv) { const mx = (sp[0] + tp[0]) / 2; return [sp, [mx, sp[1]], [mx, tp[1]], tp]; }
  return sv ? [sp, [sp[0], tp[1]], tp] : [sp, [tp[0], sp[1]], tp];
}

function wrapLabel(label, w) {
  const max = w - 18; const lines = []; let line = '', lw = 0;
  for (const ch of String(label)) { const cw = ch.charCodeAt(0) > 255 ? 12 : 6.5; if (lw + cw > max && line.length > 0) { lines.push(line); line = ch; lw = cw; } else { line += ch; lw += cw; } }
  if (line.length > 0) lines.push(line);
  return lines;
}

function buildSvg(c) {
  const map = new Map(c.r.nodes.map((x) => [x.id, x]));
  const routes = c.r.edges.map((e) => ({ e, pts: edgePoints(e, map) }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const n of c.r.nodes) { eat(n.position.x, n.position.y); eat(right(n), bottom(n)); }
  for (const { pts } of routes) for (const [x, y] of pts) eat(x, y);
  const pad = 46, head = 74, foot = 92;
  const W = Math.ceil(maxX - minX + pad * 2), H = Math.ceil(maxY - minY + pad * 2 + head + foot);
  const ox = pad - minX, oy = pad + head - minY;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Segoe UI','Microsoft YaHei',sans-serif">`);
  parts.push(`<defs>${Object.entries(EDGE_COLOR).map(([k, col]) => `<marker id="arr-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${col}"/></marker>`).join('')}</defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="#f7f8fa"/>`);
  parts.push(`<text x="${pad}" y="32" font-size="17" font-weight="700" fill="#22303f">${esc(c.title)}（${esc(c.name)}）</text>`);
  parts.push(`<text x="${pad}" y="52" font-size="11" fill="#68788c">paradigm=vertical-flow ｜ renderSpec@packages/shared/dist ｜ 分支网格+便签左置+回归走线验收快照</text>`);
  parts.push(`<g transform="translate(${ox},${oy})">`);
  parts.push(`<line x1="${c.trunkRight}" y1="${minY - 16}" x2="${c.trunkRight}" y2="${maxY + 16}" stroke="#b6c2d0" stroke-width="1" stroke-dasharray="4 4"/>`);
  parts.push(`<text x="${c.trunkRight + 4}" y="${minY - 20}" font-size="10" fill="#8b99a9">trunkRight=${c.trunkRight}</text>`);
  for (const { e, pts } of routes) {
    const col = EDGE_COLOR[e.data.kind] ?? EDGE_COLOR.next;
    parts.push(`<polyline points="${pts.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="${col}" stroke-width="1.6"${e.data.kind === 'annotate' ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#arr-${e.data.kind in EDGE_COLOR ? e.data.kind : 'next'})"/>`);
    if (e.data.label) {
      const segs = pts.slice(1).map((p, i) => [pts[i], p]);
      const m = segs[Math.floor(segs.length / 2)];
      const lx = (m[0][0] + m[1][0]) / 2, ly = (m[0][1] + m[1][1]) / 2;
      parts.push(`<text x="${lx}" y="${ly - 5}" font-size="11" fill="${col}" text-anchor="middle" paint-order="stroke" stroke="#f7f8fa" stroke-width="3.5">${esc(e.data.label)}</text>`);
    }
  }
  for (const n of c.r.nodes) {
    const st = NODE_STYLE[n.type] ?? NODE_STYLE.process;
    parts.push(`<rect x="${n.position.x}" y="${n.position.y}" width="${n.width}" height="${n.height}" rx="${st.rx}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.6"${n.type === 'comment' ? ' stroke-dasharray="6 3"' : ''}/>`);
    const lines = wrapLabel(n.data.label, n.width);
    const ty = midY(n) - ((lines.length - 1) * 15) / 2 + 4;
    lines.forEach((ln, i) => parts.push(`<text x="${n.position.x + n.width / 2}" y="${ty + i * 15}" font-size="12" fill="${st.text}" text-anchor="middle">${esc(ln)}</text>`));
    parts.push(`<text x="${n.position.x + 6}" y="${n.position.y + 13}" font-size="9" fill="${st.stroke}">${esc(n.id)}</text>`);
  }
  parts.push('</g>');
  const gline = c.checks.map((k) => `${k.g} ${k.ok ? 'PASS' : 'FAIL'}`).join(' ｜ ');
  parts.push(`<text x="${pad}" y="${H - 70}" font-size="12" font-weight="700" fill="${c.checks.every((k) => k.ok) ? '#2f9e63' : '#c65353'}">几何断言：${gline}</text>`);
  const tw = (s) => [...String(s)].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 10 : 5.5), 0);
  const legendRow = (items, y) => {
    let lx = pad;
    for (const it of items) {
      if (it.line) parts.push(`<line x1="${lx}" y1="${y - 4}" x2="${lx + 22}" y2="${y - 4}" stroke="${it.line}" stroke-width="2"/><text x="${lx + 27}" y="${y}" font-size="10" fill="#68788c">${esc(it.label)}</text>`);
      else parts.push(`<rect x="${lx}" y="${y - 12}" width="18" height="12" rx="3" fill="${it.fill}" stroke="${it.stroke}"/><text x="${lx + 23}" y="${y}" font-size="10" fill="#68788c">${esc(it.label)}</text>`);
      lx += 27 + tw(it.label) + 22;
    }
  };
  legendRow(Object.entries(NODE_STYLE).map(([k, v]) => ({ label: k, fill: v.fill, stroke: v.stroke })), H - 42);
  legendRow(Object.entries(EDGE_COLOR).filter(([k]) => c.r.edges.some((e) => e.data.kind === k)).map(([k, col]) => ({ label: KIND_LABEL[k], line: col })), H - 20);
  parts.push('</svg>');
  return parts.join('');
}

let failed = 0;
for (const c of cases) {
  const res = assertCase(c.name, c.spec);
  const file = `render-acceptance-${c.name}.svg`;
  writeFileSync(join(outDir, file), buildSvg({ ...c, ...res }), 'utf8');
  console.log(`[${c.name}] 节点=${res.r.nodes.length} 边=${res.r.edges.length} warnings=${res.warnings.length}`);
  for (const k of res.checks) { console.log(`  ${k.g} ${k.ok ? 'PASS' : 'FAIL'} ${k.detail}`); if (!k.ok) failed++; }
  for (const w of res.warnings) console.log(`  warning: ${w}`);
  console.log(`  SVG -> .work/flow/assets/${file}`);
}
console.log(failed === 0 ? '验收结论：G1/G2/G3/G4/G6 全部 PASS' : `验收结论：${failed} 项断言 FAIL`);
process.exitCode = failed === 0 ? 0 : 1;