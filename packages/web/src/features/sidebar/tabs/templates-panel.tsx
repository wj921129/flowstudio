import React, { useState } from 'react';
import { renderSpec } from '@flowstudio/shared';
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Rows3,
  Network,
  Users,
  Plus,
  GripVertical,
} from 'lucide-react';
import {
  TEMPLATES_REGISTRY,
  type DiagramTemplate,
  type TemplateCategory,
} from '../templates';
import { generateMiniSvgThumbnail } from '../../../lib/api-client';

export interface TemplatesPanelProps {
  onApplyTemplate?: (template: DiagramTemplate) => void;
}

const CATEGORY_META: Record<
  TemplateCategory,
  { title: string; icon: React.ComponentType<{ className?: string }> }
> = {
  flowchart: { title: '流程图模板', icon: GitBranch },
  swimlane: { title: '泳道图模板', icon: Rows3 },
  topology: { title: '拓扑图模板', icon: Network },
  'org-chart': { title: '组织结构图', icon: Users },
};

export const TemplatesPanel: React.FC<TemplatesPanelProps> = ({ onApplyTemplate }) => {
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    flowchart: true,
    swimlane: true,
    topology: true,
    'org-chart': true,
  });

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, template: DiagramTemplate) => {
    e.dataTransfer.setData('application/flowstudio-template-id', template.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const renderCategory = (categoryKey: TemplateCategory) => {
    const meta = CATEGORY_META[categoryKey];
    const templates = TEMPLATES_REGISTRY.filter((t) => t.category === categoryKey);
    const isOpen = openCategories[categoryKey] ?? true;
    const Icon = meta.icon;

    return (
      <div key={categoryKey} className="border-b border-fs-border/60 last:border-b-0 pb-1">
        <button
          type="button"
          onClick={() => toggleCategory(categoryKey)}
          className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-fs-text hover:bg-fs-bg/60 transition-colors select-none"
        >
          <div className="flex items-center gap-1.5">
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-fs-text-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-fs-text-muted" />
            )}
            <Icon className="w-3.5 h-3.5 text-fs-primary" />
            <span>{meta.title}</span>
          </div>
          <span className="text-[10px] text-fs-text-muted font-mono">{templates.length}</span>
        </button>

        {isOpen && (
          <div className="px-2.5 py-1.5 flex flex-col gap-2">
            {templates.map((tmpl) => (
              <div
                key={tmpl.id}
                draggable
                onDragStart={(e) => handleDragStart(e, tmpl)}
                className="group relative flex flex-col p-2.5 rounded-lg border border-fs-border/80 bg-fs-surface hover:bg-fs-bg/80 hover:border-fs-primary/70 hover:shadow-xs transition-all cursor-grab active:cursor-grabbing"
              >
                {/* 模板结构缩略图 */}
                <div
                  className="mb-2 h-24 w-full shrink-0 overflow-hidden rounded border border-fs-border/60 bg-fs-bg"
                  dangerouslySetInnerHTML={{
                    __html: generateMiniSvgThumbnail(
                      renderSpec(tmpl.spec).nodes,
                      renderSpec(tmpl.spec).edges
                    ),
                  }}
                />

                <div className="flex items-start justify-between gap-1">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-medium text-fs-text truncate group-hover:text-fs-primary transition-colors">
                      {tmpl.title}
                    </h4>
                    <p className="mt-0.5 text-[10px] text-fs-text-muted line-clamp-2 leading-tight">
                      {tmpl.description}
                    </p>
                  </div>
                  <GripVertical className="w-3 h-3 text-fs-text-muted/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                </div>

                {/* 节点数与连线数小信息 & 快速点击载入 */}
                <div className="mt-2 pt-2 border-t border-fs-border/40 flex items-center justify-between text-[10px] text-fs-text-muted">
                  <span className="font-mono">
                    {tmpl.spec.nodes.length} 节点 · {tmpl.spec.edges.length} 连线
                  </span>
                  <button
                    type="button"
                    onClick={() => onApplyTemplate?.(tmpl)}
                    className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-fs-primary/10 hover:bg-fs-primary text-fs-primary hover:text-white font-medium transition-colors"
                  >
                    <Plus className="w-2.5 h-2.5" />
                    <span>插入</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-fs-surface overflow-hidden">
      <div className="p-3 border-b border-fs-border shrink-0">
        <h3 className="text-xs font-semibold text-fs-text">业务图表模板</h3>
        <p className="mt-0.5 text-[11px] text-fs-text-muted">
          点击直接载入画布，或拖拽卡片至指定位置局部追加
        </p>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {renderCategory('flowchart')}
        {renderCategory('swimlane')}
        {renderCategory('topology')}
        {renderCategory('org-chart')}
      </div>
    </div>
  );
};
