import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from './theme-provider';

export interface ThemeToggleProps {
  className?: string;
}

/**
 * 主题切换按钮组件
 * 支持浅色与深色模式切换，带平滑过渡与中文无障碍提示
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? '切换至浅色模式' : '切换至深色模式'}
      title={isDark ? '切换至浅色模式' : '切换至深色模式'}
      className={`inline-flex items-center justify-center p-2 rounded-lg border border-fs-border bg-fs-surface text-fs-text hover:text-fs-primary hover:border-fs-primary transition-all duration-200 cursor-pointer shadow-sm ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 transition-transform duration-200 rotate-0 hover:rotate-45" />
      ) : (
        <Moon className="w-4 h-4 transition-transform duration-200 -rotate-12 hover:rotate-0" />
      )}
      <span className="sr-only">
        {isDark ? '切换至浅色模式' : '切换至深色模式'}
      </span>
    </button>
  );
};
