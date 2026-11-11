import type { FlowEdge, FlowNode } from '@flowstudio/shared';
import { getNodeRegistryEntry } from '@flowstudio/shared';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SHAPE_COLORS: Record<string, { fill: string; stroke: string }> = {
  'start-end': { fill: '#dcfce7', stroke: '#16a34a' },
  process: { fill: '#dbeafe', stroke: '#2563eb' },
  decision: { fill: '#fef9c3', stroke: '#ca8a04' },
  io: { fill: '#ede9fe', stroke: '#7c3aed' },
  document: { fill: '#f1f5f9', stroke: '#475569' },
  subprocess: { fill: '#e0e7ff', stroke: '#4338ca' },
  database: { fill: '#fae8ff', stroke: '#a21caf' },
  comment: { fill: '#fefce8', stroke: '#eab308' },
  group: { fill: 'rgba(148,163,184,.08)', stroke: '#94a3b8' },
  pool: { fill: 'rgba(59,130,246,.05)', stroke: '#3b82f6' },
  lane: { fill: 'rgba(255,255,255,.4)', stroke: '#60a5fa' },
  'uml-lifeline': { fill: '#f8fafc', stroke: '#64748b' },
  'uml-activation': { fill: '#cbd5e1', stroke: '#475569' },
  'uml-message': { fill: 'none', stroke: '#334155' },
  'rich-card': { fill: '#fffbeb', stroke: '#d97706' },
  'arch-microservice': { fill: '#eef2ff', stroke: '#6366f1' },
  'arch-gateway': { fill: '#f0f9ff', stroke: '#0ea5e9' },
  'arch-db-shard': { fill: '#f0fdfa', stroke: '#14b8a6' },
  'arch-cache': { fill: '#fffbeb', stroke: '#f59e0b' },
  'arch-k8s-pod': { fill: '#eff6ff', stroke: '#3b82f6' },
  'arch-docker': { fill: '#f0f9ff', stroke: '#0284c7' },
};

const ARCH_GLYPH: Record<string, string> = {
  'arch-microservice': '⚙',
  'arch-gateway': ' ⇄',
  'arch-db-shard': '🗄',
  'arch-cache': '⚡',
  'arch-k8s-pod': '☸',
  'arch-docker': '🐳',
};

const wrapText = (text: string, maxChars: number, maxLines = 3): string[] => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const lines: string[] = [];
  let rest = clean;
  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      break;
    }
    const cut = rest.lastIndexOf(' ', maxChars);
    const at = cut > maxChars * 0.5 ? cut : maxChars;
    lines.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (lines.length === maxLines && rest) lines[maxLines - 1] += '…';
  return lines;
};

const renderNode = (n: FlowNode): string => {
  const { x, y } = n.position;
  const w = n.width ?? getNodeRegistryEntry(n.type)?.defaultSize.width ?? 160;
  const h = n.height ?? getNodeRegistryEntry(n.type)?.defaultSize.height ?? 80;
  const c = SHAPE_COLORS[n.type] ?? SHAPE_COLORS.process;
  const label = n.data.label ?? '';
  const cx = x + w / 2;
  const cy = y + h / 2;
  const textLines = wrapText(label, Math.max(6, Math.floor(w / 13)), n.type === 'rich-card' ? 2 : 3);
  const textSvg = textLines
    .map((t, i) => `<text x="${cx}" y="${cy + (i - (textLines.length - 1) / 2) * 14 + 4}" text-anchor="middle" font-size="12" fill="#1e293b">${esc(t)}</text>`)
    .join('');
  let shape = '';
  switch (n.type) {
    case 'decision':
      shape = `<polygon points="${cx},${y + 2} ${x + w - 2},${cy} ${cx},${y + h - 2} ${x + 2},${cy}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`;
      break;
    case 'io':
      shape = `<polygon points="${x + Math.min(22, w * 0.2)},${y + 2} ${x + w - 2},${y + 2} ${x + w - Math.min(22, w * 0.2)},${y + h - 2} ${x + 2},${y + h - 2}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`;
      break;
    case 'database':
      shape = `<path d="M ${x + 2} ${y + 10} A ${w / 2 - 2} 9 0 0 1 ${x + w - 2} ${y + 10} L ${x + w - 2} ${y + h - 10} A ${w / 2 - 2} 9 0 0 1 ${x + 2} ${y + h - 10} Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`;
      break;
    case 'document':
      shape = `<path d="M ${x + 2} ${y + 2} L ${x + w - 2} ${y + 2} L ${x + w - 2} ${y + h - 10} Q ${cx} ${y + h - 2} ${x + 2} ${y + h - 10} Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`;
      break;
    case 'subprocess':
      shape = `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="3" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/><line x1="${x + 8}" y1="${y + 2}" x2="${x + 8}" y2="${y + h - 2}" stroke="${c.stroke}" stroke-width="1.5"/><line x1="${x + w - 8}" y1="${y + 2}" x2="${x + w - 8}" y2="${y + h - 2}" stroke="${c.stroke}" stroke-width="1.5"/>`;
      break;
    case 'start-end':
      shape = `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="${Math.min(h / 2, 26)}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`;
      break;
    case 'comment':
      shape = `<path d="M ${x + 2} ${y + 2} L ${x + w - 14} ${y + 2} L ${x + w - 2} ${y + 14} L ${x + w - 2} ${y + h - 2} L ${x + 2} ${y + h - 2} Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/><polyline points="${x + w - 14},${y + 2} ${x + w - 14},${y + 14} ${x + w - 2},${y + 14}" fill="none" stroke="${c.stroke}" stroke-width="1.2"/>`;
      break;
    case 'group':
      shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4" stroke-dasharray="6,4"/>`;
      break;
    case 'pool':
    case 'lane':
      shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"${n.type === 'lane' ? ' stroke-dasharray="5,3"' : ''}/>`;
      break;
    case 'uml-lifeline':
      shape = `<rect x="${cx - Math.min(70, w / 2 - 4)}" y="${y + 4}" width="${Math.min(140, w - 8)}" height="30" rx="5" fill="#f8fafc" stroke="${c.stroke}" stroke-width="1.5"/><line x1="${cx}" y1="${y + 34}" x2="${cx}" y2="${y + h - 4}" stroke="${c.stroke}" stroke-width="1.4" stroke-dasharray="5,4"/>`;
      break;
    case 'uml-activation':
      shape = `<rect x="${cx - 7}" y="${y + 2}" width="14" height="${h - 4}" rx="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/>`;
      break;
    case 'uml-message': {
      const kind = (n.data as Record<string, unknown>).messageKind ?? 'sync';
      const dash = kind === 'return' ? ' stroke-dasharray="6,4"' : '';
      const open = kind !== 'sync';
      shape = open
        ? `<line x1="${x + 4}" y1="${cy}" x2="${x + w - 9}" y2="${cy}" stroke="${c.stroke}" stroke-width="1.6"${dash}/><polyline points="${x + w - 12},${cy - 4.5} ${x + w - 4},${cy} ${x + w - 12},${cy + 4.5}" fill="none" stroke="${c.stroke}" stroke-width="1.6"/>`
        : `<line x1="${x + 4}" y1="${cy}" x2="${x + w - 9}" y2="${cy}" stroke="${c.stroke}" stroke-width="1.6"/><polygon points="${x + w - 10},${cy - 4} ${x + w - 3},${cy} ${x + w - 10},${cy + 4}" fill="${c.stroke}"/>`;
      break;
    }
    case 'rich-card': {
      const status = ((n.data as Record<string, unknown>).cardStatus as string) ?? 'draft';
      const statusColor = status === 'done' ? '#059669' : status === 'wip' ? '#2563eb' : '#64748b';
      const md = String((n.data as Record<string, unknown>).markdown ?? '');
      const mdLines = wrapText(md, Math.max(8, Math.floor(w / 9)), Math.max(2, Math.floor((h - 42) / 15)));
      shape =
        `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="9" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>` +
        `<circle cx="${x + 15}" cy="${y + 15}" r="6" fill="${c.stroke}"/>` +
        `<rect x="${x + 26}" y="${y + 9}" width="${Math.max(28, w * 0.32)}" height="11" rx="5" fill="${statusColor}"/>` +
        `<text x="${x + 26 + Math.max(28, w * 0.32) / 2}" y="${y + 17.5}" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${esc(status.toUpperCase())}</text>` +
        mdLines.map((t, i) => `<text x="${x + 10}" y="${y + 38 + i * 15}" font-size="11" fill="#44403c">${esc(t)}</text>`).join('');
      break;
    }
    default: {
      const isArch = n.type.startsWith('arch-');
      if (isArch) {
        const glyph = ARCH_GLYPH[n.type] ?? '▣';
        const env = (n.data as Record<string, unknown>).envTag as string | undefined;
        const proto = (n.data as Record<string, unknown>).protocol as string | undefined;
        const health = (n.data as Record<string, unknown>).health as string | undefined;
        shape =
          `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="9" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>` +
          `<text x="${cx}" y="${cy - 12}" text-anchor="middle" font-size="16">${glyph}</text>` +
          `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="12" font-weight="600" fill="#1e293b">${esc(label)}</text>` +
          (proto ? `<text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="9" font-family="monospace" fill="${c.stroke}">${esc(proto)}</text>` : '') +
          (env ? `<rect x="${x + w - 44}" y="${y + 4}" width="38" height="13" rx="6.5" fill="${env.toLowerCase() === 'prod' ? '#f43f5e' : '#f59e0b'}"/><text x="${x + w - 25}" y="${y + 13.5}" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${esc(env)}</text>` : '') +
          (health ? `<circle cx="${x + 10}" cy="${y + 10}" r="4" fill="${health === 'ok' ? '#10b981' : health === 'warn' ? '#f59e0b' : '#f43f5e'}"/>` : '');
      } else {
        shape = `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="5" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>` + textSvg;
      }
    }
  }
  const extraText =
    n.type === 'pool' || n.type === 'lane'
      ? `<text x="${x + 14}" y="${y + 20}" font-size="12" font-weight="700" fill="#1e40af">${esc(label)}</text>`
      : '';
  return `<g class="fs-node" data-id="${esc(n.id)}">${shape}${extraText}</g>`;
};

const renderEdge = (e: FlowEdge, nodes: FlowNode[]): string => {
  const s = nodes.find((n) => n.id === e.source);
  const t = nodes.find((n) => n.id === e.target);
  if (!s || !t) return '';
  const sc = { x: s.position.x + (s.width ?? 160) / 2, y: s.position.y + (s.height ?? 80) / 2 };
  const tc = { x: t.position.x + (t.width ?? 160) / 2, y: t.position.y + (t.height ?? 80) / 2 };
  const pts = e.data?.waypoints && e.data.waypoints.length >= 2 ? [sc, ...e.data.waypoints, tc] : [sc, tc];
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const labelPos = pts[Math.floor(pts.length / 2)];
  const dash = e.data?.routingType === 'straight' ? ' stroke-dasharray="7,4"' : '';
  return (
    `<g class="fs-edge" data-id="${esc(e.id)}" data-source="${esc(e.source)}" data-target="${esc(e.target)}">` +
    `<path d="${path}" fill="none" stroke="#475569" stroke-width="1.6" marker-end="url(#fs-arrow)"${dash}/>` +
    (e.data?.label ? `<text x="${labelPos.x}" y="${labelPos.y - 6}" text-anchor="middle" font-size="11" fill="#475569">${esc(e.data.label)}</text>` : '') +
    `</g>`
  );
};

export function buildStandaloneHtml(
  a: string | FlowNode[],
  b?: FlowNode[] | FlowEdge[],
  c?: FlowEdge[] | string
): string {
  let title = 'FlowStudio 流程图';
  let nodes: FlowNode[] = [];
  let edges: FlowEdge[] = [];
  if (typeof a === 'string') {
    title = a;
    nodes = (b as FlowNode[]) || [];
    edges = (c as FlowEdge[]) || [];
  } else {
    nodes = a || [];
    edges = (b as FlowEdge[]) || [];
    title = (c as string) || 'FlowStudio 流程图';
  }
  const graphNodes = JSON.stringify(nodes).replace(/</g, '\\u003c');
  const graphEdges = JSON.stringify(edges).replace(/</g, '\\u003c');
  const shapesSvg = edges.map((e) => renderEdge(e, nodes)).join('\n') + '\n' + nodes.map((n) => renderNode(n)).join('\n');
  const bounds = nodes.reduce(
    (acc, n) => ({
      minX: Math.min(acc.minX, n.position.x),
      minY: Math.min(acc.minY, n.position.y),
      maxX: Math.max(acc.maxX, n.position.x + (n.width ?? 160)),
      maxY: Math.max(acc.maxY, n.position.y + (n.height ?? 80)),
    }),
    { minX: 0, minY: 0, maxX: 800, maxY: 600 }
  );
  const meta = JSON.stringify({
    minX: bounds.minX - 60,
    minY: bounds.minY - 60,
    w: bounds.maxX - bounds.minX + 120,
    h: bounds.maxY - bounds.minY + 120,
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} · FlowStudio 离线快照</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;background:#f8fafc}
  #bar{position:fixed;top:12px;left:12px;z-index:10;display:flex;gap:6px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:6px;box-shadow:0 2px 10px rgba(15,23,42,.08)}
  #bar button{border:1px solid #e2e8f0;background:#fff;border-radius:7px;padding:5px 10px;font-size:12px;cursor:pointer;color:#334155}
  #bar button:hover{background:#f1f5f9;border-color:#94a3b8}
  #bar .title{font-size:12px;font-weight:700;color:#0f172a;padding:5px 6px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #stage{position:fixed;inset:0;cursor:grab;touch-action:none}
  #stage.panning{cursor:grabbing}
  svg{width:100%;height:100%}
  .fs-node,.fs-edge{transition:opacity .18s}
  .fs-node{cursor:pointer}
  .fs-node:hover{filter:brightness(1.05)}
  .dimmed{opacity:.14}
  .spotlit .fs-node:not(.dimmed){filter:drop-shadow(0 0 6px rgba(59,130,246,.65))}
  #hint{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);font-size:11px;color:#64748b;background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:4px 14px;z-index:10;opacity:.9}
  #zoomLabel{font-size:12px;color:#475569;padding:5px 4px;min-width:44px;text-align:center}
</style>
</head>
<body>
<div id="bar">
  <span class="title" title="${esc(title)}">${esc(title)}</span>
  <button id="zin">＋</button><span id="zoomLabel">100%</span><button id="zout">－</button>
  <button id="fit">适应画布</button><button id="clear">取消聚焦</button>
</div>
<div id="stage"></div>
<div id="hint">滚轮缩放 · 拖拽平移 · 点击节点聚光灯聚焦其上下游 · 双击空白或 Esc 取消</div>
<script>
window.__FLOWSTUDIO_SNAPSHOT__ = { title: ${JSON.stringify(title)}, nodes: ${graphNodes}, edges: ${graphEdges}, meta: ${meta} };
</script>
<script>
(function(){
  var D = window.__FLOWSTUDIO_SNAPSHOT__, stage = document.getElementById('stage');
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS,'svg');
  svg.innerHTML = '<defs><marker id="fs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="#475569"/></marker></defs>' +
    ${JSON.stringify(shapesSvg)};
  stage.appendChild(svg);
  var view = { x: 0, y: 0, k: 1 };
  var meta = D.meta;
  function apply(){
    svg.setAttribute('transform-origin','0 0');
    svg.style.transformOrigin = '0 0';
    svg.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
    document.getElementById('zoomLabel').textContent = Math.round(view.k * 100) + '%';
  }
  function fit(){
    var r = stage.getBoundingClientRect();
    var k = Math.min(r.width / meta.w, r.height / meta.h, 1.5) * 0.92;
    view.k = k;
    view.x = (r.width - meta.w * k) / 2 - meta.minX * k;
    view.y = (r.height - meta.h * k) / 2 - meta.minY * k;
    apply();
  }
  var adj = {};
  D.edges.forEach(function(e){
    (adj[e.source] = adj[e.source] || []).push(e.target);
    (adj[e.target] = adj[e.target] || []).push(e.source);
  });
  var spotlight = null;
  function applySpotlight(){
    var nodesG = svg.querySelectorAll('.fs-node'), edgesG = svg.querySelectorAll('.fs-edge');
    if (!spotlight) {
      nodesG.forEach(function(g){ g.classList.remove('dimmed'); });
      edgesG.forEach(function(g){ g.classList.remove('dimmed'); });
      document.body.classList.remove('spotlit');
      return;
    }
    document.body.classList.add('spotlit');
    var keep = {}; keep[spotlight] = true;
    (adj[spotlight] || []).forEach(function(id){ keep[id] = true; });
    nodesG.forEach(function(g){ g.classList.toggle('dimmed', !keep[g.getAttribute('data-id')]); });
    edgesG.forEach(function(g){
      g.classList.toggle('dimmed', !(keep[g.getAttribute('data-source')] && keep[g.getAttribute('data-target')]));
    });
  }
  stage.addEventListener('wheel', function(ev){
    ev.preventDefault();
    var r = stage.getBoundingClientRect();
    var mx = ev.clientX - r.left, my = ev.clientY - r.top;
    var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    var k2 = Math.min(4, Math.max(0.08, view.k * factor));
    view.x = mx - ((mx - view.x) * k2) / view.k;
    view.y = my - ((my - view.y) * k2) / view.k;
    view.k = k2; apply();
  }, { passive: false });
  var panning = null;
  stage.addEventListener('pointerdown', function(ev){
    if (ev.button !== 0) return;
    var nodeG = ev.target.closest && ev.target.closest('.fs-node');
    if (nodeG && !ev.shiftKey) {
      var id = nodeG.getAttribute('data-id');
      spotlight = (spotlight === id) ? null : id;
      applySpotlight();
      return;
    }
    panning = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
    stage.classList.add('panning');
    stage.setPointerCapture(ev.pointerId);
  });
  stage.addEventListener('pointermove', function(ev){
    if (!panning) return;
    view.x = panning.vx + (ev.clientX - panning.x);
    view.y = panning.vy + (ev.clientY - panning.y);
    apply();
  });
  stage.addEventListener('pointerup', function(){ panning = null; stage.classList.remove('panning'); });
  stage.addEventListener('dblclick', function(ev){ if (!ev.target.closest('.fs-node')) { spotlight = null; applySpotlight(); } });
  document.addEventListener('keydown', function(ev){ if (ev.key === 'Escape') { spotlight = null; applySpotlight(); } });
  document.getElementById('zin').onclick = function(){ view.k = Math.min(4, view.k * 1.2); apply(); };
  document.getElementById('zout').onclick = function(){ view.k = Math.max(0.08, view.k / 1.2); apply(); };
  document.getElementById('fit').onclick = fit;
  document.getElementById('clear').onclick = function(){ spotlight = null; applySpotlight(); };
  fit();
})();
</script>
</body>
</html>
`;
}
