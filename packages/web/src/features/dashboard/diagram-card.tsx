import React, { useState } from 'react';
import type { DiagramSummary } from '@flowstudio/shared';
import { Copy, Edit2, Trash2, MoreVertical, ExternalLink } from 'lucide-react';

export interface DiagramCardProps {
  diagram: DiagramSummary;
  onOpen: (id: string) => void;
  onRename: (diagram: DiagramSummary) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export const DiagramCard: React.FC<DiagramCardProps> = ({
  diagram,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const formattedTime = new Date(diagram.updatedAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      onClick={() => onOpen(diagram.id)}
      className="group relative flex flex-col rounded-xl border overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
      style={{
        backgroundColor: 'var(--fs-bg-surface, #ffffff)',
        borderColor: 'var(--fs-border-primary, #e5e7eb)',
      }}
    >
      {/* 缩略图预览区 */}
      <div
        className="w-full h-36 flex items-center justify-center p-3 relative overflow-hidden border-b transition-colors"
        style={{
          backgroundColor: 'var(--fs-bg-canvas, #f9fafb)',
          borderColor: 'var(--fs-border-primary, #e5e7eb)',
        }}
      >
        {diagram.thumbnail ? (
          <div
            className="w-full h-full flex items-center justify-center"
            dangerouslySetInnerHTML={{ __html: diagram.thumbnail }}
          />
        ) : (
          <div className="text-xs text-[var(--fs-text-secondary,#9ca3af)] flex items-center gap-1.5 select-none">
            <span>暂无预览</span>
          </div>
        )}

        {/* 悬浮进入蒙层快捷图标 */}
        <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="px-3 py-1.5 rounded-full text-xs font-medium text-white bg-black/70 flex items-center gap-1 shadow-sm">
            <span>打开画布</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      {/* 底部信息与操作 */}
      <div className="p-4 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4
            className="text-sm font-semibold truncate transition-colors group-hover:text-[var(--fs-primary,#4f46e5)]"
            style={{ color: 'var(--fs-text-primary, #111827)' }}
          >
            {diagram.title}
          </h4>
          <p
            className="text-xs mt-1 truncate"
            style={{ color: 'var(--fs-text-secondary, #6b7280)' }}
          >
            {diagram.description || `最近更新: ${formattedTime}`}
          </p>
        </div>

        {/* 更多菜单按钮 */}
        <div
          className="relative"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded-md transition-colors hover:bg-black/5 text-[var(--fs-text-secondary,#6b7280)]"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setMenuOpen(false)}
              />
              <div
                className="absolute right-0 top-7 w-32 rounded-lg border py-1 shadow-xl z-30 animate-in fade-in zoom-in-95 duration-100 text-xs"
                style={{
                  backgroundColor: 'var(--fs-bg-surface, #ffffff)',
                  borderColor: 'var(--fs-border-primary, #e5e7eb)',
                  color: 'var(--fs-text-primary, #111827)',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRename(diagram);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-black/5 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>重命名</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDuplicate(diagram.id);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-black/5 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>创建副本</span>
                </button>

                <div className="h-px bg-[var(--fs-border-primary,#e5e7eb)] my-1" />

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    if (window.confirm(`确定要删除流程图「${diagram.title}」吗？`)) {
                      onDelete(diagram.id);
                    }
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
