import React, { useState, useMemo } from 'react';
import {
  Search,
  ChevronDown,
  ChevronRight,
  GripVertical,
  X,
} from 'lucide-react';
import {
  getAllNodeRegistryEntries,
  type FlowNodeType,
  type NodeRegistryEntry,
} from '@flowstudio/shared';
import { useSidebarStore } from '../sidebar-store';
import { getThemePreset } from '../styles/theme-presets';
import { resolveNodeStyle } from '../styles/style-resolver';
import { useFlowStore } from '../../../stores/flow-store';

export interface CategorizedElements {
  basic: NodeRegistryEntry[];
  flowchart: NodeRegistryEntry[];
  containers: NodeRegistryEntry[];
}

export function filterElements(
  elements: NodeRegistryEntry[],
  keyword: string
): NodeRegistryEntry[] {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return elements;
  return elements.filter(
    (e) =>
      (e.label && e.label.toLowerCase().includes(trimmed)) ||
      (e.type && e.type.toLowerCase().includes(trimmed)) ||
      (Boolean((e as any).id) && String((e as any).id).toLowerCase().includes(trimmed)) ||
      (e.mcpDescription && e.mcpDescription.toLowerCase().includes(trimmed))
  );
}

export function categorizeElements(entries: NodeRegistryEntry[]): CategorizedElements {
  // 三组按功能互斥划分，任意图元只归属一组：通用元素 / 流程图专用符号 / 容器
  const basicTypes: FlowNodeType[] = ['start-end', 'process', 'decision', 'comment'];
  const flowchartTypes: FlowNodeType[] = ['io', 'document', 'subprocess', 'database'];
  const containerTypes: FlowNodeType[] = ['pool', 'lane', 'group'];

  return {
    basic: entries.filter((e) => basicTypes.includes(e.type)),
    flowchart: entries.filter((e) => flowchartTypes.includes(e.type)),
    containers: entries.filter((e) => containerTypes.includes(e.type)),
  };
}

export const ElementsPanel: React.FC = () => {
  const searchKeyword = useSidebarStore((s) => s.searchKeyword);
  const setSearchKeyword = useSidebarStore((s) => s.setSearchKeyword);
  const activeThemeId = useSidebarStore((s) => s.activeThemeId);
  const currentTheme = useMemo(() => getThemePreset(activeThemeId), [activeThemeId]);
  const addNode = useFlowStore((s) => s.addNode);

  const handleItemClick = (type: FlowNodeType) => {
    const existingCount = useFlowStore.getState().nodes.length;
    const offset = (existingCount % 10) * 25;
    const newNode = addNode(type, { x: 350 + offset, y: 220 + offset });
    if (newNode?.id) {
      useFlowStore.getState().setSelectedNodes([newNode.id]);
    }
  };

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    basic: true,
    flowchart: true,
    containers: true,
  });

  const toggleSection = (sec: string) => {
    setOpenSections((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  const allEntries = useMemo(() => getAllNodeRegistryEntries(), []);
  const filtered = useMemo(
    () => filterElements(allEntries, searchKeyword),
    [allEntries, searchKeyword]
  );
  const categorized = useMemo(() => categorizeElements(filtered), [filtered]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, type: FlowNodeType) => {
    e.dataTransfer.setData('application/flowstudio-node-type', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  const renderShapeThumbnail = (type: FlowNodeType) => {
    const style = resolveNodeStyle(type, currentTheme);
    const stroke = style.borderColor;
    const fill = style.fillColor;

    switch (type) {
      case 'start-end':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <rect x="2" y="3" width="32" height="18" rx="9" fill={fill} stroke={stroke} strokeWidth="1.5" />
          </svg>
        );
      case 'process':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <rect x="2" y="3" width="32" height="18" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
          </svg>
        );
      case 'decision':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <polygon points="18,2 34,12 18,22 2,12" fill={fill} stroke={stroke} strokeWidth="1.5" />
          </svg>
        );
      case 'io':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <polygon points="8,3 34,3 28,21 2,21" fill={fill} stroke={stroke} strokeWidth="1.5" />
          </svg>
        );
      case 'document':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <path d="M 2 3 L 34 3 L 34 17 Q 26 14 18 17 Q 10 20 2 17 Z" fill={fill} stroke={stroke} strokeWidth="1.5" />
          </svg>
        );
      case 'subprocess':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <rect x="2" y="3" width="32" height="18" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
            <line x1="7" y1="3" x2="7" y2="21" stroke={stroke} strokeWidth="1.5" />
            <line x1="29" y1="3" x2="29" y2="21" stroke={stroke} strokeWidth="1.5" />
          </svg>
        );
      case 'database':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <ellipse cx="18" cy="5" rx="14" ry="3" fill={fill} stroke={stroke} strokeWidth="1.5" />
            <path d="M 4 5 L 4 19 A 14 3 0 0 0 32 19 L 32 5" fill={fill} stroke={stroke} strokeWidth="1.5" />
          </svg>
        );
      case 'comment':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <path d="M 3 2 L 27 2 L 33 8 L 33 22 L 3 22 Z" fill="#fef9c3" stroke="#ca8a04" strokeWidth="1.5" />
            <polyline points="27,2 27,8 33,8" fill="none" stroke="#ca8a04" strokeWidth="1.5" />
          </svg>
        );
      case 'pool':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <rect x="2" y="2" width="32" height="20" rx="1" fill="none" stroke={stroke} strokeWidth="1.5" />
            <rect x="2" y="2" width="8" height="20" fill={currentTheme.tokens.poolHeaderBg} stroke={stroke} strokeWidth="1" />
            <line x1="10" y1="12" x2="34" y2="12" stroke={stroke} strokeWidth="1" strokeDasharray="2,2" />
          </svg>
        );
      case 'lane':
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <rect x="2" y="3" width="32" height="18" fill="rgba(255,255,255,0.4)" stroke={stroke} strokeWidth="1.5" strokeDasharray="3,2" />
          </svg>
        );
      default:
        return (
          <svg className="w-9 h-6" viewBox="0 0 36 24">
            <rect x="2" y="3" width="32" height="18" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
          </svg>
        );
    }
  };

  const renderSection = (title: string, secKey: string, items: NodeRegistryEntry[]) => {
    if (items.length === 0) return null;
    const isOpen = openSections[secKey] ?? true;

    return (
      <div key={secKey} className="border-b border-fs-border/60 last:border-b-0 pb-1">
        <button
          type="button"
          onClick={() => toggleSection(secKey)}
          className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-fs-text hover:bg-fs-bg/60 transition-colors select-none"
        >
          <div className="flex items-center gap-1.5">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-fs-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-fs-text-muted" />}
            <span>{title}</span>
          </div>
          <span className="text-[10px] text-fs-text-muted font-mono">{items.length}</span>
        </button>

        {isOpen && (
          <div className="px-2 py-1.5 grid grid-cols-2 gap-1.5">
            {items.map((entry) => (
              <div
                key={`${secKey}-${entry.type}`}
                draggable
                onDragStart={(e) => handleDragStart(e, entry.type)}
                onClick={() => handleItemClick(entry.type)}
                className="group relative flex flex-col items-center justify-center p-2 rounded-md border border-fs-border/80 bg-fs-surface hover:bg-fs-bg hover:border-fs-primary/70 hover:shadow-xs transition-all cursor-pointer select-none"
                title={`点击直接添加或拖拽至画布：${entry.label} (${entry.mcpDescription || ''})`}
              >
                <div className="flex items-center justify-center py-1 group-hover:scale-105 transition-transform">
                  {renderShapeThumbnail(entry.type)}
                </div>
                <span className="mt-1 text-[11px] font-medium text-fs-text text-center truncate max-w-full">
                  {entry.label}
                </span>
                <GripVertical className="w-2.5 h-2.5 text-fs-text-muted/40 absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-fs-surface overflow-hidden">
      {/* 顶部搜索框与当前色彩提示 */}
      <div className="p-2.5 border-b border-fs-border flex flex-col gap-2 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-fs-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索图形元素..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-fs-bg border border-fs-border rounded-md text-fs-text placeholder:text-fs-text-muted focus:outline-none focus:border-fs-primary transition-colors"
          />
          {searchKeyword && (
            <button
              type="button"
              onClick={() => setSearchKeyword('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fs-text-muted hover:text-fs-text"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* 风格联动徽章 */}
        <div className="flex items-center justify-between px-1 text-[11px] text-fs-text-muted">
          <span>当前色彩风格:</span>
          <span className="flex items-center gap-1 font-medium text-fs-text">
            <span
              className="w-2.5 h-2.5 rounded-full border border-black/10 inline-block"
              style={{ backgroundColor: currentTheme.tokens.nodeBorder }}
            />
            {currentTheme.title}
          </span>
        </div>
      </div>

      {/* 图形元素二级分组折叠列表 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {renderSection('基础图形', 'basic', categorized.basic)}
        {renderSection('Flowchart 流程图', 'flowchart', categorized.flowchart)}
        {renderSection('泳池/泳道容器', 'containers', categorized.containers)}
      </div>
    </div>
  );
};
