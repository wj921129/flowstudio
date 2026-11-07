/**
 * @fileoverview 浮动工具栏通用按钮组件 (ToolbarButton)
 * @description 遵循设计令牌规范，具备悬浮气泡提示 (Tooltip)、快捷键提示徽标、高亮激活态与无障碍支持
 */

import React from 'react';

export interface ToolbarButtonProps {
  /** 按钮展示的图标组件 (来自 lucide-react) */
  icon: React.ComponentType<{ className?: string }>;
  /** 按钮操作名称或中文描述 */
  label: string;
  /** 快捷键提示（如 'V', 'Ctrl+Z'） */
  shortcut?: string;
  /** 是否处于激活选中状态 */
  active?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 点击处理回调 */
  onClick?: () => void;
  /** 是否为破坏性/高危动作（如删除） */
  danger?: boolean;
  /** 外部传入的附加样式类名 */
  className?: string;
}

export const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  icon: Icon,
  label,
  shortcut,
  active = false,
  disabled = false,
  onClick,
  danger = false,
  className = '',
}) => {
  // 组装状态类名
  const getStateClassName = () => {
    if (disabled) {
      return 'opacity-40 cursor-not-allowed text-[var(--fs-text-muted)]';
    }

    if (active) {
      return 'bg-[var(--fs-primary)]/15 text-[var(--fs-primary)] font-semibold shadow-xs ring-1 ring-[var(--fs-primary)]/30';
    }

    if (danger) {
      return 'text-[var(--fs-palette-4)] hover:bg-[var(--fs-palette-4)]/10 hover:text-[var(--fs-palette-4)]';
    }

    return 'text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] hover:bg-[var(--fs-bg)]';
  };

  return (
    <div className={`group relative flex items-center justify-center ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={`p-2 rounded-xl transition-all duration-150 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--fs-selection-ring)] ${getStateClassName()}`}
      >
        <Icon className="w-4 h-4 shrink-0 transition-transform active:scale-95" />
      </button>

      {/* 气泡提示 (Tooltip + 快捷键徽标) */}
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full mb-2 hidden group-hover:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs whitespace-nowrap bg-[var(--fs-surface)] text-[var(--fs-text)] border border-[var(--fs-border)] shadow-lg z-50 select-none animate-in fade-in duration-150"
      >
        <span>{label}</span>
        {shortcut && (
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-[var(--fs-bg)] border border-[var(--fs-border)] text-[var(--fs-text-muted)]">
            {shortcut}
          </kbd>
        )}
      </div>
    </div>
  );
};
