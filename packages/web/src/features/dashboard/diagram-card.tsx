import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { DiagramSummary } from '@flowstudio/shared';
import { Copy, Edit2, Trash2, MoreVertical, ExternalLink } from 'lucide-react';

export interface DiagramCardProps {
  diagram: DiagramSummary;
  onOpen: (id: string) => void;
  onRename?: (diagram: DiagramSummary, newTitle?: string) => void;
  onRenameTitle?: (id: string, newTitle: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRequestDelete?: (diagram: DiagramSummary) => void;
}

function sanitizeSvg(svg: string): string {
  if (!svg || typeof svg !== 'string') return '';
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svg, 'image/svg+xml');
      if (!doc.querySelector('parsererror')) {
        const root = doc.documentElement;
        if (root && root.tagName.toLowerCase() === 'svg') {
          const dangerous = root.querySelectorAll('script, foreignObject, iframe, embed, object, link, style, animate, set');
          dangerous.forEach((el) => el.remove());
          const cleanAttrs = (el: Element) => {
            for (let i = el.attributes.length - 1; i >= 0; i--) {
              const attr = el.attributes[i];
              const name = attr.name.toLowerCase();
              const val = attr.value.trim().toLowerCase();
              if (name.startsWith('on') || val.startsWith('javascript:') || val.startsWith('data:') || val.startsWith('vbscript:')) {
                el.removeAttribute(attr.name);
              }
            }
          };
          cleanAttrs(root);
          root.querySelectorAll('*').forEach(cleanAttrs);
          return new XMLSerializer().serializeToString(root);
        }
      }
    } catch {}
  }
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<(iframe|embed|object|link|style)[\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^>\s]+/gi, '')
    .replace(/href\s*=\s*(['"])\s*(javascript|data|vbscript):.*?\1/gi, '');
}

export const DiagramCard: React.FC<DiagramCardProps> = ({
  diagram,
  onOpen,
  onRename,
  onRenameTitle,
  onDuplicate,
  onDelete,
  onRequestDelete,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(diagram.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditTitle(diagram.title);
  }, [diagram.title]);

  useEffect(() => {
    if (isEditingTitle) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditingTitle]);

  const safeThumbnail = useMemo(() => sanitizeSvg(diagram.thumbnail || ''), [diagram.thumbnail]);

  const formattedTime = new Date(diagram.updatedAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleSaveRename = () => {
    const trimmed = editTitle.trim();
    setIsEditingTitle(false);
    if (trimmed && trimmed !== diagram.title) {
      if (onRenameTitle) {
        onRenameTitle(diagram.id, trimmed);
      } else if (onRename) {
        onRename(diagram, trimmed);
      }
    } else {
      setEditTitle(diagram.title);
    }
  };

  const handleCancelRename = () => {
    setIsEditingTitle(false);
    setEditTitle(diagram.title);
  };

  return (
    <div
      onClick={() => onOpen(diagram.id)}
      className={`group relative flex flex-col rounded-xl border cursor-pointer transition-all duration-200 hover:shadow-lg ${
        menuOpen ? 'z-30' : 'hover:-translate-y-0.5'
      }`}
      style={{
        backgroundColor: 'var(--fs-surface)',
        borderColor: 'var(--fs-border)',
      }}
    >
      <div
        className="w-full h-36 rounded-t-xl flex items-center justify-center p-3 relative overflow-hidden border-b transition-colors"
        style={{
          backgroundColor: 'var(--fs-bg)',
          borderColor: 'var(--fs-border)',
        }}
      >
        {safeThumbnail ? (
          <div
            className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full"
            dangerouslySetInnerHTML={{ __html: safeThumbnail }}
          />
        ) : (
          <div className="text-xs text-[var(--fs-text-muted)] flex items-center gap-1.5 select-none">
            <span>暂无预览</span>
          </div>
        )}

        <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="px-3 py-1.5 rounded-full text-xs font-medium text-white bg-black/70 flex items-center gap-1 shadow-sm">
            <span>打开画布</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      <div className="p-4 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isEditingTitle ? (
            <input
              ref={inputRef}
              type="text"
              value={editTitle}
              maxLength={100}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename();
                else if (e.key === 'Escape') handleCancelRename();
              }}
              onBlur={handleSaveRename}
              className="w-full px-2 py-0.5 text-sm font-semibold rounded border outline-none ring-2 ring-blue-500/20"
              style={{
                backgroundColor: 'var(--fs-bg)',
                borderColor: 'var(--fs-primary)',
                color: 'var(--fs-text)',
              }}
            />
          ) : (
            <h4
              className="text-sm font-semibold truncate transition-colors group-hover:text-[var(--fs-primary)]"
              style={{ color: 'var(--fs-text)' }}
            >
              {diagram.title}
            </h4>
          )}
          <p
            className="text-xs mt-1 truncate"
            style={{ color: 'var(--fs-text-muted)' }}
          >
            {diagram.description || `最近更新: ${formattedTime}`}
          </p>
        </div>

        <div
          className="relative"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5 text-[var(--fs-text-muted)] cursor-pointer"
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
                  backgroundColor: 'var(--fs-surface)',
                  borderColor: 'var(--fs-border)',
                  color: 'var(--fs-text)',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setIsEditingTitle(true);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
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
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>创建副本</span>
                </button>

                <div className="h-px bg-[var(--fs-border)] my-1" />

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    if (onRequestDelete) {
                      onRequestDelete(diagram);
                    } else {
                      onDelete(diagram.id);
                    }
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
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
