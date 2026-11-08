import React from 'react';
import { AlertCircle, RefreshCw, PlusCircle, X } from 'lucide-react';
import type { DiagramTemplate } from '../templates';

export interface TemplateConfirmModalProps {
  template: DiagramTemplate | null;
  isOpen: boolean;
  onClose: () => void;
  onOverwrite: () => void;
  onAppend: () => void;
}

export const TemplateConfirmModal: React.FC<TemplateConfirmModalProps> = ({
  template,
  isOpen,
  onClose,
  onOverwrite,
  onAppend,
}) => {
  if (!isOpen || !template) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-fs-surface border border-fs-border rounded-xl shadow-xl overflow-hidden flex flex-col">
        {/* 弹窗头部 */}
        <div className="px-5 py-4 border-b border-fs-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-fs-text">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
            <h3 className="text-sm font-semibold">载入模板方式确认</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-fs-text-muted hover:text-fs-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 弹窗说明主体 */}
        <div className="px-5 py-4 text-xs text-fs-text flex flex-col gap-2.5">
          <p>
            当前画布已有绘制内容。您即将载入模板：
            <span className="font-semibold text-fs-primary ml-1">
              「{template.title}」
            </span>
            （包含 {template.nodes.length} 个节点，{template.edges.length} 条连线）。
          </p>
          <div className="p-2.5 bg-fs-bg/60 border border-fs-border/60 rounded-md text-[11px] text-fs-text-muted">
            🛡️ <strong>安全保障</strong>：若选择“覆盖当前画布”，系统将在清空前
            <span className="text-fs-primary font-medium">自动创建一次安全备份快照</span>
            ，您可随时在右侧快照抽屉中一键恢复历史。
          </div>
        </div>

        {/* 按钮操作栏 */}
        <div className="px-5 py-3.5 bg-fs-bg/40 border-t border-fs-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-fs-border text-xs font-medium text-fs-text hover:bg-fs-surface transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onAppend();
              onClose();
            }}
            className="px-3 py-1.5 rounded-lg border border-fs-primary/40 bg-fs-primary/10 hover:bg-fs-primary/20 text-xs font-medium text-fs-primary transition-colors flex items-center gap-1"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            追加至当前画布
          </button>
          <button
            type="button"
            onClick={() => {
              onOverwrite();
              onClose();
            }}
            className="px-3 py-1.5 rounded-lg bg-fs-primary hover:bg-fs-primary/90 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            覆盖当前画布
          </button>
        </div>
      </div>
    </div>
  );
};
