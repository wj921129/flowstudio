import React, { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import {
  getAllNodeRegistryEntries,
  NODE_CATEGORIES,
  type FlowNodeType,
  type NodeCategory,
  type NodeRegistryEntry,
} from '@flowstudio/shared';
import { useSidebarStore } from '../sidebar-store';
import { getThemePreset } from '../styles/theme-presets';
import { resolveNodeStyle } from '../styles/style-resolver';
import { useFlowStore } from '../../../stores/flow-store';

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

export function categorizeElements(entries: NodeRegistryEntry[]): Record<NodeCategory, NodeRegistryEntry[]> {
  const grouped = {} as Record<NodeCategory, NodeRegistryEntry[]>;
  NODE_CATEGORIES.forEach((cat) => {
    grouped[cat] = entries.filter((e) => e.category === cat);
  });
  return grouped;
}

const UML_THUMBS: Record<string, React.ReactNode> = {
  'uml-lifeline': (
    <svg className="w-9 h-6" viewBox="0 0 36 24">
      <rect x="10" y="2" width="16" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="18" y1="9" x2="18" y2="22" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.5,2.5" />
    </svg>
  ),
  'uml-activation': (
    <svg className="w-9 h-6" viewBox="0 0 36 24">
      <rect x="15" y="2" width="6" height="20" fill="currentColor" opacity="0.25" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  'uml-message': (
    <svg className="w-9 h-6" viewBox="0 0 36 24">
      <line x1="3" y1="12" x2="28" y2="12" stroke="currentColor" strokeWidth="1.6" />
      <polygon points="28,8.5 34,12 28,15.5" fill="currentColor" />
      <text x="18" y="7" textAnchor="middle" fontSize="6" fill="currentColor">msg</text>
    </svg>
  ),
  'rich-card': (
    <svg className="w-9 h-6" viewBox="0 0 36 24">
      <rect x="4" y="2" width="28" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9" cy="7" r="2" fill="currentColor" opacity="0.5" />
      <rect x="13" y="5.5" width="12" height="3" rx="1.5" fill="currentColor" opacity="0.4" />
      <line x1="8" y1="13" x2="28" y2="13" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <line x1="8" y1="17" x2="22" y2="17" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
    </svg>
  ),
};

const ARCH_THUMBS: Record<string, { icon: string }> = {
  'arch-microservice': { icon: 'M18 4 L28 9 L28 17 L18 22 L8 17 L8 9 Z' },
  'arch-gateway': { icon: 'M6 12 H24 M24 12 L20 8 M24 12 L20 16' },
  'arch-db-shard': { icon: 'M12 6 a6 3 0 0 1 12 0 a6 3 0 0 1 -12 0 M12 6 v10 a6 3 0 0 0 12 0 v-10 M12 11 a6 3 0 0 0 12 0' },
  'arch-cache': { icon: 'M20 3 L10 13 H17 L15 21 L26 10 H19 Z' },
  'arch-k8s-pod': { icon: 'M18 4 L27 9 L27 17 L18 22 L9 17 L9 9 Z M18 9 L22 11.5 L22 15.5 L18 18 L14 15.5 L14 11.5 Z' },
  'arch-docker': { icon: 'M6 13 H30 M8 13 V9 H12 V13 M12 13 V9 H16 V13 M16 13 V9 H20 V13 M20 13 V9 H24 V13 M24 13 V10 H28 V13' },
};

const renderShapeThumbnail = (type: FlowNodeType, fill: string, stroke: string, poolHeaderBg: string) => {
  const arch = ARCH_THUMBS[type];
  if (arch) {
    return (
      <svg className="w-9 h-6" viewBox="0 0 36 24">
        <path d={arch.icon} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  switch (type) {
    case 'uml-lifeline':
    case 'uml-activation':
    case 'uml-message':
      return <span className="text-fs-text">{UML_THUMBS[type]}</span>;
    case 'rich-card':
      return (
        <svg className="w-9 h-6" viewBox="0 0 36 24">
          <rect x="4" y="2" width="28" height="20" rx="3" fill={fill} stroke={stroke} strokeWidth="1.4" />
          <circle cx="9" cy="7" r="2" fill={stroke} opacity="0.55" />
          <rect x="13" y="5.5" width="12" height="3" rx="1.5" fill={stroke} opacity="0.4" />
          <line x1="8" y1="13" x2="28" y2="13" stroke={stroke} strokeWidth="1.2" opacity="0.6" />
          <line x1="8" y1="17" x2="22" y2="17" stroke={stroke} strokeWidth="1.2" opacity="0.6" />
        </svg>
      );
    case 'start-end':
      return (
        <svg className="w-9 h-6" viewBox="0 0 36 24">
          <rect x="2" y="3" width="32" height="18" rx="9" fill={fill} stroke={stroke} strokeWidth="1.5" />
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
          <rect x="2" y="2" width="8" height="20" fill={poolHeaderBg} stroke={stroke} strokeWidth="1" />
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

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, type: FlowNodeType) => {
    e.dataTransfer.setData('application/flowstudio-node-type', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  const allEntries = useMemo(() => getAllNodeRegistryEntries(), []);
  const filtered = useMemo(
    () => filterElements(allEntries, searchKeyword),
    [allEntries, searchKeyword]
  );
  const categorized = useMemo(() => categorizeElements(filtered), [filtered]);
  const visibleCategories = NODE_CATEGORIES.filter((c) => categorized[c].length > 0);

  const renderGrid = (cat: NodeCategory) => (
    <div className="px-2 pb-1.5 grid grid-cols-4 gap-1">
      {categorized[cat].map((entry) => (
        <div
          key={entry.type}
          draggable
          onDragStart={(e) => handleDragStart(e, entry.type)}
          onClick={() => handleItemClick(entry.type)}
          className="group relative flex items-center justify-center h-10 rounded-md border border-fs-border/70 bg-fs-surface hover:bg-fs-bg hover:border-fs-primary/70 hover:shadow-xs transition-all cursor-pointer select-none"
          title={`${entry.label}${entry.mcpDescription ? `：${entry.mcpDescription}` : ''}`}
          aria-label={entry.label}
        >
          <div className="flex items-center justify-center scale-90 group-hover:scale-100 transition-transform">
            {renderShapeThumbnail(
              entry.type,
              resolveNodeStyle(entry.type, currentTheme).fillColor,
              resolveNodeStyle(entry.type, currentTheme).borderColor,
              currentTheme.tokens.poolHeaderBg
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-fs-surface overflow-hidden">
      <div className="p-2 border-b border-fs-border shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-fs-text-muted absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索图元..."
            className="w-full pl-7 pr-6 py-1 text-xs bg-fs-bg border border-fs-border rounded-md text-fs-text placeholder:text-fs-text-muted focus:outline-none focus:border-fs-primary transition-colors"
          />
          {searchKeyword && (
            <button
              type="button"
              onClick={() => setSearchKeyword('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fs-text-muted hover:text-fs-text"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {visibleCategories.length === 0 ? (
          <div className="py-8 text-center text-xs text-fs-text-muted">无匹配图元</div>
        ) : (
          visibleCategories.map((cat) => (
            <div key={cat} className="border-b border-fs-border/50 last:border-b-0 py-1">
              <div className="px-2.5 py-1 text-[11px] font-medium text-fs-text-muted flex items-center justify-between">
                <span>{cat}</span>
                <span className="text-[10px] font-mono opacity-75">{categorized[cat].length}</span>
              </div>
              {renderGrid(cat)}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
