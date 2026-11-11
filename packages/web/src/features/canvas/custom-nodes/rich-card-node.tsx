import React, { useState, useRef, useEffect } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData, RichCardStatus } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';
import { useFlowStore } from '../../../stores/flow-store';

const STATUS_META: Record<RichCardStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-400/20 text-slate-500 border-slate-400/40' },
  wip: { label: 'WIP', cls: 'bg-blue-500/15 text-blue-600 border-blue-500/40' },
  done: { label: 'Done', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/40' },
};

const OWNER_HUES = [212, 262, 152, 22, 322, 42, 182, 2];

const renderInline = (text: string, keyBase: string): React.ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((seg, i) => {
    if (seg.startsWith('**') && seg.endsWith('**')) {
      return <strong key={`${keyBase}-b${i}`}>{seg.slice(2, -2)}</strong>;
    }
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      return (
        <code key={`${keyBase}-c${i}`} className="px-1 py-px rounded bg-[var(--fs-surface)] text-[11px] font-mono">
          {seg.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${keyBase}-t${i}`}>{seg}</React.Fragment>;
  });

const renderMarkdown = (md: string): React.ReactNode[] => {
  const lines = md.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flushList = (key: string) => {
    if (list.length) {
      blocks.push(
        <ul key={key} className="list-disc list-inside space-y-0.5">
          {list}
        </ul>
      );
      list = [];
    }
  };
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed)) {
      list.push(<li key={`li-${i}`}>{renderInline(trimmed.replace(/^[-*]\s+/, ''), `li-${i}`)}</li>);
    } else if (/^\d+\.\s+/.test(trimmed)) {
      list.push(<li key={`li-${i}`}>{renderInline(trimmed.replace(/^\d+\.\s+/, ''), `li-${i}`)}</li>);
    } else {
      flushList(`ul-${i}`);
      if (trimmed.startsWith('### ')) {
        blocks.push(
          <div key={`h-${i}`} className="text-xs font-bold">
            {renderInline(trimmed.slice(4), `h-${i}`)}
          </div>
        );
      } else if (trimmed.startsWith('## ')) {
        blocks.push(
          <div key={`h-${i}`} className="text-[13px] font-bold">
            {renderInline(trimmed.slice(3), `h-${i}`)}
          </div>
        );
      } else if (trimmed.startsWith('# ')) {
        blocks.push(
          <div key={`h-${i}`} className="text-sm font-bold">
            {renderInline(trimmed.slice(2), `h-${i}`)}
          </div>
        );
      } else if (trimmed) {
        blocks.push(
          <div key={`p-${i}`} className="leading-snug">
            {renderInline(trimmed, `p-${i}`)}
          </div>
        );
      }
    }
  });
  flushList('ul-end');
  return blocks;
};

export const RichCardNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const data = props.data;
  const status: RichCardStatus = data.cardStatus ?? 'draft';
  const owner = typeof data.owner === 'string' ? data.owner : '';
  const markdown = typeof data.markdown === 'string' ? data.markdown : '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(markdown);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setValue(markdown);
  }, [markdown, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
    }
  }, [editing]);

  const save = () => {
    if (!editing) return;
    setEditing(false);
    if (value !== markdown) useFlowStore.getState().updateNodeData(props.id, { markdown: value });
  };

  const hue = OWNER_HUES[owner.length % OWNER_HUES.length] ?? 212;

  return (
    <BaseNodeWrapper {...props} customContent className="!rounded-xl overflow-hidden">
      <div
        className="w-full h-full flex flex-col min-h-0"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <div className="flex items-center justify-between gap-1 px-2 pt-1.5 pb-1 border-b border-[var(--fs-node-border)]/50 shrink-0">
          <div className="flex items-center gap-1 min-w-0">
            {owner ? (
              <span
                className="w-4.5 h-4.5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                style={{ backgroundColor: `hsl(${hue} 62% 52%)` }}
                title={owner}
              >
                {owner.slice(0, 1).toUpperCase()}
              </span>
            ) : null}
            <span className="text-[10px] font-medium text-[var(--fs-text-muted)] truncate">{owner || props.data.label}</span>
          </div>
          <span className={`px-1.5 py-px rounded-full text-[9px] font-bold border leading-3.5 shrink-0 ${STATUS_META[status].cls}`}>
            {STATUS_META[status].label}
          </span>
        </div>
        {editing ? (
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditing(false);
                setValue(markdown);
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="nodrag nopan nowheel flex-1 min-h-0 w-full resize-none px-2 py-1.5 text-[11px] leading-snug bg-[var(--fs-surface)] text-[var(--fs-text)] outline-none font-mono"
            placeholder="# 标题&#10;- 列表项"
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden px-2 py-1.5 space-y-1 text-[11px] text-[var(--fs-node-text)] cursor-text">
            {markdown ? renderMarkdown(markdown) : <span className="opacity-50">双击编辑 Markdown…</span>}
          </div>
        )}
      </div>
    </BaseNodeWrapper>
  );
};
