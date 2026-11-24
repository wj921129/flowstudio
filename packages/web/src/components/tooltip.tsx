import React from 'react';

export interface TooltipProps {
  label: string;
  shortcut?: string;
  placement?: 'top' | 'bottom';
  children: React.ReactNode;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  label,
  shortcut,
  placement = 'top',
  children,
  className = '',
}) => {
  const posClass = placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-2';
  return (
    <div className={`group relative inline-flex items-center justify-center ${className}`}>
      {children}
      <div
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${posClass} hidden group-hover:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs whitespace-nowrap bg-fs-surface text-fs-text border border-fs-border shadow-lg z-[60] select-none`}
      >
        <span>{label}</span>
        {shortcut && (
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-fs-bg border border-fs-border text-fs-text-muted">
            {shortcut}
          </kbd>
        )}
      </div>
    </div>
  );
};
