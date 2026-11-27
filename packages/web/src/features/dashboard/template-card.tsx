import React, { useMemo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { DiagramTemplate } from '../sidebar/templates/types.js';
import { getTemplateMiniThumbnail } from '../../lib/mini-thumbnail.js';

export interface TemplateCardProps {
  template: DiagramTemplate;
  categoryLabel: string;
  variant?: 'compact' | 'default';
  isCreating?: boolean;
  disabled?: boolean;
  className?: string;
  onSelect: (template: DiagramTemplate) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  categoryLabel,
  variant = 'default',
  isCreating = false,
  disabled = false,
  className = '',
  onSelect,
}) => {
  const thumbnail = useMemo(() => getTemplateMiniThumbnail(template), [template]);
  const isCompact = variant === 'compact';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(template)}
      className={`group flex flex-col text-left rounded-xl border bg-[var(--fs-surface)] transition-all duration-200 hover:border-fs-primary/60 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer disabled:opacity-50 disabled:pointer-events-none ${className}`}
      style={{ borderColor: 'var(--fs-border)' }}
    >
      <div
        className="w-full aspect-[16/10] rounded-t-xl border-b p-2.5 sm:p-3 flex items-center justify-center relative overflow-hidden"
        style={{
          backgroundColor: 'var(--fs-bg)',
          backgroundImage: 'radial-gradient(var(--fs-border) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
          borderColor: 'var(--fs-border)',
        }}
      >
        <div
          className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full dark:opacity-90"
          dangerouslySetInnerHTML={{ __html: thumbnail }}
        />

        <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="px-3 py-1 rounded-full text-xs font-medium text-white bg-black/70 flex items-center gap-1 shadow-sm">
            <span>{isCreating ? '创建中...' : '使用模板'}</span>
            {!isCreating && <ArrowUpRight className="w-3.5 h-3.5" />}
          </span>
        </div>
      </div>

      <div className={isCompact ? 'p-3 flex-1 flex flex-col justify-between gap-1.5 w-full' : 'p-4 flex-1 flex flex-col justify-between gap-3 w-full'}>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs sm:text-sm font-semibold truncate group-hover:text-fs-primary transition-colors">
              {template.title}
            </span>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-fs-primary/10 text-fs-primary shrink-0">
              {categoryLabel}
            </span>
          </div>
          <p
            className={`text-xs text-[var(--fs-text-muted)] ${
              isCompact ? 'line-clamp-1' : 'line-clamp-2 leading-relaxed'
            }`}
          >
            {isCreating ? '正在创建画布...' : template.description}
          </p>
        </div>

        {!isCompact && (
          <div
            className="pt-2.5 border-t flex items-center justify-between text-[11px] w-full"
            style={{ borderColor: 'var(--fs-border)' }}
          >
            <span className="font-mono text-[var(--fs-text-muted)]">
              {template.spec.nodes.length} 节点 · {template.spec.edges.length} 连线
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium bg-fs-primary/10 text-fs-primary group-hover:bg-fs-primary group-hover:text-white transition-colors">
              {isCreating ? '创建中...' : '使用此模板'}
            </span>
          </div>
        )}
      </div>
    </button>
  );
};
