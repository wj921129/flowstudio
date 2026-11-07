/**
 * @fileoverview 流程图图形库左侧侧边栏组件 (ShapePalette)
 * @description 展示 9 种基础图元卡片，支持拖拽添加至画布 (Drag-to-Add)、侧边栏收起/展开，遵循设计令牌与无障碍规范
 */

import React, { useState } from 'react';
import {
  CirclePlay,
  Square,
  Diamond,
  ArrowRightLeft,
  FileText,
  Workflow,
  Database,
  StickyNote,
  Layers,
  Shapes,
  PanelLeftClose,
  PanelLeftOpen,
  GripVertical,
} from 'lucide-react';
import {
  getAllNodeRegistryEntries,
  type FlowNodeType,
  type NodeRegistryEntry,
} from '@flowstudio/shared';

/** 图标解析字典：将注册表中的图标字符串映射到对应的 Lucide 图标组件 */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  CirclePlay,
  Square,
  Diamond,
  ArrowRightLeft,
  FileText,
  Workflow,
  Database,
  StickyNote,
  Layers,
};

/**
 * 根据图标名称安全获取 Lucide 图标组件
 */
function resolveNodeIcon(iconName: string): React.ComponentType<{ className?: string }> {
  return ICON_MAP[iconName] ?? Square;
}

export interface ShapePaletteProps {
  className?: string;
  defaultCollapsed?: boolean;
}

/**
 * 流程图图元调色板侧边栏组件
 */
export const ShapePalette: React.FC<ShapePaletteProps> = ({
  className = '',
  defaultCollapsed = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const entries: NodeRegistryEntry[] = getAllNodeRegistryEntries();

  /**
   * 拖拽启动处理器：在 dataTransfer 中写入节点类型标识，并声明 move 拖拽效果
   */
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, type: FlowNodeType) => {
    e.dataTransfer.setData('application/flowstudio-node-type', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside
      aria-label="图元选择库"
      className={`h-full flex flex-col bg-fs-surface border-r border-fs-border shrink-0 select-none z-10 transition-[width] duration-200 ease-in-out ${
        isCollapsed ? 'w-12' : 'w-52'
      } ${className}`}
    >
      {/* 顶部标题与折叠切换栏 */}
      <div className="h-12 px-3 flex items-center justify-between border-b border-fs-border shrink-0">
        {!isCollapsed && (
          <div className="flex items-center gap-2 overflow-hidden">
            <Shapes className="w-4 h-4 text-fs-primary shrink-0" />
            <span className="text-xs font-semibold text-fs-text tracking-wide whitespace-nowrap">
              图形库
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-fs-bg border border-fs-border text-fs-text-muted font-mono">
              {entries.length}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          aria-label={isCollapsed ? '展开图形库' : '收起图形库'}
          title={isCollapsed ? '展开图形库' : '收起图形库'}
          className={`p-1.5 rounded-lg text-fs-text-muted hover:text-fs-text hover:bg-fs-bg transition-colors cursor-pointer ${
            isCollapsed ? 'mx-auto' : ''
          }`}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* 图元列表区 */}
      <div
        className={`flex-1 overflow-y-auto overflow-x-hidden ${
          isCollapsed
            ? 'p-1.5 flex flex-col items-center space-y-2'
            : 'p-2 space-y-2'
        }`}
      >
        {entries.map((entry) => {
          const IconComponent = resolveNodeIcon(entry.icon);

          if (isCollapsed) {
            return (
              <div
                key={entry.type}
                draggable
                onDragStart={(e) => handleDragStart(e, entry.type)}
                title={`${entry.label} (${entry.mcpDescription})`}
                aria-label={entry.label}
                className="w-9 h-9 flex items-center justify-center rounded-lg border border-fs-border bg-fs-surface hover:border-fs-primary hover:text-fs-primary hover:bg-fs-bg hover:shadow-xs transition-all duration-150 cursor-grab active:cursor-grabbing select-none text-fs-text"
              >
                <IconComponent className="w-4 h-4 shrink-0" />
              </div>
            );
          }

          return (
            <div
              key={entry.type}
              draggable
              onDragStart={(e) => handleDragStart(e, entry.type)}
              title={`${entry.label} - ${entry.mcpDescription}`}
              className="group flex items-center gap-2.5 px-3 py-2 rounded-lg border border-fs-border bg-fs-surface hover:border-fs-primary hover:bg-fs-bg/60 hover:shadow-xs transition-all duration-150 cursor-grab active:cursor-grabbing select-none"
            >
              <div className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md bg-fs-bg border border-fs-border text-fs-text group-hover:text-fs-primary group-hover:border-fs-primary/40 transition-colors">
                <IconComponent className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-medium text-fs-text truncate">
                  {entry.label}
                </span>
                <span className="text-[10px] text-fs-text-muted truncate">
                  {entry.defaultSize.width} × {entry.defaultSize.height}
                </span>
              </div>
              <GripVertical className="w-3.5 h-3.5 text-fs-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
          );
        })}
      </div>

      {/* 底部拖拽辅助说明 */}
      {!isCollapsed && (
        <div className="p-2 border-t border-fs-border/60 text-center shrink-0">
          <p className="text-[11px] text-fs-text-muted select-none">
            拖拽图形至画布添加
          </p>
        </div>
      )}
    </aside>
  );
};
