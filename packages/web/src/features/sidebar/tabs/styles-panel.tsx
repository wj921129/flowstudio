import React from 'react';
import { Check, Palette, Sparkles, Sliders } from 'lucide-react';
import { THEME_PRESETS, type ThemePreset } from '../styles/theme-presets';
import { useSidebarStore } from '../sidebar-store';

export interface StylesPanelProps {
  onApplyThemeToCanvas?: (theme: ThemePreset, preserveManual: boolean) => void;
}

export const StylesPanel: React.FC<StylesPanelProps> = ({ onApplyThemeToCanvas }) => {
  const activeThemeId = useSidebarStore((s) => s.activeThemeId);
  const setActiveThemeId = useSidebarStore((s) => s.setActiveThemeId);
  const preserveManualStyles = useSidebarStore((s) => s.preserveManualStyles);
  const setPreserveManualStyles = useSidebarStore((s) => s.setPreserveManualStyles);

  const handleSelectTheme = (theme: ThemePreset) => {
    setActiveThemeId(theme.id);
    onApplyThemeToCanvas?.(theme, preserveManualStyles);
  };

  return (
    <div className="flex flex-col h-full bg-fs-surface overflow-hidden">
      {/* 头部说明 */}
      <div className="p-3 border-b border-fs-border shrink-0">
        <div className="flex items-center gap-1.5">
          <Palette className="w-4 h-4 text-fs-primary" />
          <h3 className="text-xs font-semibold text-fs-text">设计风格与配色方案</h3>
        </div>
        <p className="mt-1 text-[11px] text-fs-text-muted leading-tight">
          切换色彩方案将联动变换左侧图元，并可一键批量换肤当前图表
        </p>
      </div>

      {/* 偏好配置开关 */}
      <div className="p-3 border-b border-fs-border bg-fs-bg/40 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sliders className="w-3.5 h-3.5 text-fs-text-muted" />
          <label htmlFor="preserve-manual-toggle" className="text-xs font-medium text-fs-text cursor-pointer select-none">
            切换时保留手动微调样式
          </label>
        </div>
        <input
          id="preserve-manual-toggle"
          type="checkbox"
          checked={preserveManualStyles}
          onChange={(e) => setPreserveManualStyles(e.target.checked)}
          className="w-4 h-4 rounded text-fs-primary focus:ring-fs-primary cursor-pointer"
        />
      </div>

      {/* 配色方案列表 */}
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2.5 custom-scrollbar">
        {THEME_PRESETS.map((theme) => {
          const isActive = theme.id === activeThemeId;
          const { tokens } = theme;

          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => handleSelectTheme(theme)}
              className={`w-full text-left p-2.5 rounded-lg border transition-all flex flex-col gap-2 ${
                isActive
                  ? 'border-fs-primary bg-fs-primary/5 shadow-xs ring-1 ring-fs-primary/40'
                  : 'border-fs-border/80 bg-fs-surface hover:bg-fs-bg/80 hover:border-fs-primary/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-fs-text">{theme.title}</span>
                  {isActive && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-fs-primary text-white font-medium flex items-center gap-0.5">
                      <Check className="w-2.5 h-2.5" />
                      当前
                    </span>
                  )}
                </div>

                {/* 色盘小圆点组合 */}
                <div className="flex items-center gap-1">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-xs"
                    style={{ backgroundColor: tokens.nodeBorder }}
                    title={`主边框色: ${tokens.nodeBorder}`}
                  />
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-xs"
                    style={{ backgroundColor: tokens.nodeBg }}
                    title={`底色: ${tokens.nodeBg}`}
                  />
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-xs"
                    style={{ backgroundColor: tokens.poolHeaderBg }}
                    title={`表头色: ${tokens.poolHeaderBg}`}
                  />
                </div>
              </div>

              <p className="text-[11px] text-fs-text-muted line-clamp-1">{theme.description}</p>

              {/* 视觉示意微缩流程图 */}
              <div className="w-full h-11 rounded border border-fs-border/60 bg-white/60 dark:bg-black/20 p-1 flex items-center justify-around">
                <div
                  className="px-2 py-0.5 rounded text-[9px] font-medium border"
                  style={{
                    backgroundColor: tokens.nodeBg,
                    borderColor: tokens.nodeBorder,
                    color: tokens.nodeText,
                  }}
                >
                  开始
                </div>
                <div className="w-4 h-0.5" style={{ backgroundColor: tokens.edgeStroke }} />
                <div
                  className="px-2 py-0.5 rounded text-[9px] font-medium border"
                  style={{
                    backgroundColor: tokens.nodeBg,
                    borderColor: tokens.nodeBorder,
                    color: tokens.nodeText,
                  }}
                >
                  处理
                </div>
                <div className="w-4 h-0.5" style={{ backgroundColor: tokens.edgeStroke }} />
                <div
                  className="px-2 py-0.5 rounded text-[9px] font-medium border"
                  style={{
                    backgroundColor: tokens.poolHeaderBg,
                    borderColor: tokens.nodeBorder,
                    color: tokens.nodeText,
                  }}
                >
                  结束
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 底部全图刷新提示 */}
      <div className="p-2.5 border-t border-fs-border bg-fs-bg/30 text-center shrink-0">
        <span className="text-[10px] text-fs-text-muted flex items-center justify-center gap-1">
          <Sparkles className="w-3 h-3 text-fs-primary" />
          点击任意主题即可立即应用至全图
        </span>
      </div>
    </div>
  );
};
