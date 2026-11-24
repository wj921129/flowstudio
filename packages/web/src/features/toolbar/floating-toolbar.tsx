/**
 * @fileoverview 画布主悬浮工具栏组件 (FloatingToolbar)
 * @description 采用毛玻璃质感置于画布底部居中，支持选择、平移、连线与便签模式切换、撤销重做历史控制与删除操作
 */

import React, { useEffect, useCallback, useState } from 'react';
import { Panel, useReactFlow } from '@xyflow/react';
import {
  MousePointer2,
  Hand,
  ArrowUpRight,
  CornerDownRight,
  StickyNote,
  Undo2,
  Redo2,
  Trash2,
  Check,
  MessageSquare,
} from 'lucide-react';
import {
  EDGE_STROKE_STYLES,
  EDGE_STROKE_STYLE_LABELS,
  getDefaultNodeSize,
  getEdgeDashArray,
  type EdgeStrokeStyle,
} from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { useCommentsStore } from '../comments';
import { ToolbarButton } from './toolbar-button';

const LINE_STYLE_ICONS = Object.fromEntries(
  EDGE_STROKE_STYLES.map((s) => [
    s,
    ({ className }: { className?: string }) => (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
        <line x1="3" y1="12" x2="21" y2="12" strokeDasharray={getEdgeDashArray(s)} />
      </svg>
    ),
  ])
) as Record<EdgeStrokeStyle, React.FC<{ className?: string }>>;

const EDGE_MODE_OPTIONS = [
  { value: 'orthogonal' as const, label: '折线连线', icon: CornerDownRight },
  { value: 'straight' as const, label: '直线连线', icon: ArrowUpRight },
];

const LINE_STYLE_OPTIONS: HoverMenuOption<EdgeStrokeStyle>[] = EDGE_STROKE_STYLES.map((s) => ({
  value: s,
  label: EDGE_STROKE_STYLE_LABELS[s],
  icon: LINE_STYLE_ICONS[s] ?? LINE_STYLE_ICONS.solid,
}));

interface HoverMenuOption<T extends string> {
  value: T;
  label: string;
  icon: React.FC<{ className?: string }>;
}

function ToolbarHoverMenu<T extends string>({
  icon: Icon,
  label,
  shortcut,
  active,
  selectedValue,
  options,
  onButtonClick,
  onSelect,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  shortcut?: string;
  active?: boolean;
  selectedValue: T;
  options: readonly HoverMenuOption<T>[];
  onButtonClick?: () => void;
  onSelect: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative flex items-center justify-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-expanded={open}
        onClick={onButtonClick}
        className={`p-2 rounded-xl transition-all duration-150 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--fs-selection-ring)] ${
          active
            ? 'bg-[var(--fs-primary)]/15 text-[var(--fs-primary)] font-semibold shadow-xs ring-1 ring-[var(--fs-primary)]/30'
            : 'text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] hover:bg-[var(--fs-bg)]'
        }`}
      >
        <Icon className="w-4 h-4 shrink-0 transition-transform active:scale-95" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 z-50"
        >
          <div className="min-w-[124px] p-1 rounded-xl backdrop-blur-md bg-[var(--fs-surface)]/95 border border-[var(--fs-border)] shadow-xl flex flex-col gap-0.5">
            {options.map((opt) => {
              const OptIcon = opt.icon;
              const isSelected = opt.value === selectedValue;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={() => onSelect(opt.value)}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--fs-primary)]/15 text-[var(--fs-primary)] font-medium'
                      : 'text-[var(--fs-text)] hover:bg-[var(--fs-bg)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <OptIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>{opt.label}</span>
                  </span>
                  {isSelected && <Check className="w-3 h-3 shrink-0" />}
                </button>
              );
            })}
            {shortcut && (
              <div className="mt-0.5 pt-1 border-t border-[var(--fs-border)]/70 px-2 flex items-center justify-between text-[10px] text-[var(--fs-text-muted)]">
                <span>激活连线</span>
                <kbd className="px-1 py-0.5 font-mono rounded bg-[var(--fs-bg)] border border-[var(--fs-border)]">{shortcut}</kbd>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface FloatingToolbarProps {
  /** 外部传入的附加样式类名 */
  className?: string;
}

export const FloatingToolbar: React.FC<FloatingToolbarProps> = ({ className = '' }) => {
  const activeTool = useFlowStore((s) => s.activeTool);
  const isSpacePanning = useFlowStore((s) => s.isSpacePanning);
  const edgeConnectMode = useFlowStore((s) => s.edgeConnectMode);
  const isShiftPressed = useFlowStore((s) => s.isShiftPressed);
  const setActiveTool = useFlowStore((s) => s.setActiveTool);
  const setEdgeConnectMode = useFlowStore((s) => s.setEdgeConnectMode);
  const displayEdgeMode = isShiftPressed
    ? edgeConnectMode === 'orthogonal'
      ? 'straight'
      : 'orthogonal'
    : edgeConnectMode;
  const canUndo = useFlowStore((s) => s.canUndo);
  const canRedo = useFlowStore((s) => s.canRedo);
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);
  const deleteSelected = useFlowStore((s) => s.deleteSelected);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const selectedEdgeId = useFlowStore((s) => s.selectedEdgeId);
  const selectedEdgeLabelId = useFlowStore((s) => s.selectedEdgeLabelId);
  const addNode = useFlowStore((s) => s.addNode);
  const setSelectedNodes = useFlowStore((s) => s.setSelectedNodes);
  const setSelectedEdge = useFlowStore((s) => s.setSelectedEdge);
  const isCommentMode = useCommentsStore((s) => s.isCommentMode);
  const setCommentMode = useCommentsStore((s) => s.setCommentMode);
  const commentsCount = useCommentsStore((s) => s.comments.length);

  const { screenToFlowPosition } = useReactFlow();

  // 是否有图元被选中（用于判断删除按钮状态）
  const hasSelection = selectedNodeIds.length > 0 || Boolean(selectedEdgeId) || Boolean(selectedEdgeLabelId);

  /**
   * 快速在当前视口中心添加便签节点 (comment)
   */
  const handleAddNote = useCallback(() => {
    // 优先以 React Flow 主画布容器中心为锚点，降级采用窗口物理中心
    const canvasEl = document.querySelector('.react-flow');
    let screenCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      screenCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }

    const flowPos = screenToFlowPosition(screenCenter);
    const defaultSize = getDefaultNodeSize('comment');
    const centeredPos = {
      x: flowPos.x - defaultSize.width / 2,
      y: flowPos.y - defaultSize.height / 2,
    };

    const newNode = addNode('comment', centeredPos);
    if (newNode?.id) {
      setSelectedNodes([newNode.id]);
      setSelectedEdge(null);
    }
  }, [screenToFlowPosition, addNode, setSelectedNodes, setSelectedEdge]);

  const handleActivateConnectTool = useCallback(() => {
    setActiveTool('connect');
  }, [setActiveTool]);

  const handleSelectConnectMode = useCallback(
    (mode: 'orthogonal' | 'straight') => {
      setEdgeConnectMode(mode);
      setActiveTool('connect');
    },
    [setEdgeConnectMode, setActiveTool]
  );

  const edgeLineStyle = useFlowStore((s) => s.edgeLineStyle);
  const selectedEdgeStyle = useFlowStore((s) =>
    s.selectedEdgeId ? (s.edges.find((e) => e.id === s.selectedEdgeId)?.data?.style?.strokeStyle ?? 'solid') : null
  );
  const displayLineStyle = (selectedEdgeStyle ?? edgeLineStyle) as EdgeStrokeStyle;
  const handleSelectLineStyle = useCallback(
    (style: EdgeStrokeStyle) => {
      const { setEdgeLineStyle, updateEdgeData } = useFlowStore.getState();
      setEdgeLineStyle(style);
      if (selectedEdgeId) updateEdgeData(selectedEdgeId, { style: { strokeStyle: style } });
    },
    [selectedEdgeId]
  );

  // 绑定全局工具模式快捷键 (V: 选择, H: 漫游平移, C: 连线, T: 便签)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免输入框、文本域与富文本编辑被拦截
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isInput) {
        return;
      }

      // 避免带修饰键（如 Ctrl/Cmd/Alt）时冲突
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setActiveTool('select');
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setActiveTool('pan');
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        handleActivateConnectTool();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        handleAddNote();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool, handleActivateConnectTool, handleAddNote]);

  return (
    <Panel
      position="bottom-center"
      className={`!mb-6 !mx-0 z-30 pointer-events-auto ${className}`}
    >
      <div
        className="nodrag nopan flex items-center gap-1 px-2.5 py-1.5 rounded-2xl backdrop-blur-md bg-fs-surface/85 border border-fs-border shadow-xl select-none text-fs-text transition-colors"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 工具模式组 */}
        <ToolbarButton
          icon={MousePointer2}
          label="选择与移动"
          shortcut="V"
          active={activeTool === 'select' && !isSpacePanning}
          onClick={() => setActiveTool('select')}
        />
        <ToolbarButton
          icon={Hand}
          label="画布平移"
          shortcut="H"
          active={activeTool === 'pan' || isSpacePanning}
          onClick={() => setActiveTool('pan')}
        />
        <ToolbarHoverMenu
          icon={displayEdgeMode === 'straight' ? ArrowUpRight : CornerDownRight}
          label={displayEdgeMode === 'straight' ? '直线连线' : '折线连线'}
          shortcut="C"
          active={activeTool === 'connect' && !isSpacePanning}
          selectedValue={displayEdgeMode}
          options={EDGE_MODE_OPTIONS}
          onButtonClick={handleActivateConnectTool}
          onSelect={handleSelectConnectMode}
        />
        <ToolbarHoverMenu
          icon={LINE_STYLE_ICONS[displayLineStyle] ?? LINE_STYLE_ICONS.solid}
          label={`连线线型：${EDGE_STROKE_STYLE_LABELS[displayLineStyle] ?? '实线'}`}
          active={displayLineStyle !== 'solid'}
          selectedValue={displayLineStyle}
          options={LINE_STYLE_OPTIONS}
          onSelect={handleSelectLineStyle}
        />
        <ToolbarButton
          icon={StickyNote}
          label="快速便签"
          shortcut="T"
          onClick={handleAddNote}
        />
        <div className="relative flex items-center justify-center">
          <ToolbarButton
            icon={MessageSquare}
            label="画布批注"
            shortcut="M"
            active={isCommentMode}
            onClick={() => setCommentMode(!isCommentMode)}
          />
          {commentsCount > 0 && (
            <span className="pointer-events-none absolute -top-1 -right-1 px-1 py-0.2 bg-fs-primary text-white rounded-full text-[8px] font-bold">
              {commentsCount}
            </span>
          )}
        </div>

        {/* 分隔线 */}
        <div className="w-px h-5 bg-fs-border mx-1 shrink-0" />

        {/* 历史记录组 */}
        <ToolbarButton
          icon={Undo2}
          label="撤销"
          shortcut="Ctrl+Z"
          disabled={!canUndo}
          onClick={undo}
        />
        <ToolbarButton
          icon={Redo2}
          label="重做"
          shortcut="Ctrl+Shift+Z"
          disabled={!canRedo}
          onClick={redo}
        />

        {/* 分隔线 */}
        <div className="w-px h-5 bg-fs-border mx-1 shrink-0" />

        {/* 快捷动作组 */}
        <ToolbarButton
          icon={Trash2}
          label="删除选中"
          shortcut="Delete"
          disabled={!hasSelection}
          danger
          onClick={deleteSelected}
        />
      </div>
    </Panel>
  );
};
