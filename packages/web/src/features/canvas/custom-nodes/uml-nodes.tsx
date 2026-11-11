import React, { useState, useRef, useEffect } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData, UmlMessageKind } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';
import { useFlowStore } from '../../../stores/flow-store';

const useHeaderEditor = (id: string, label: string) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setValue(label);
  }, [label, editing]);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);
  const save = () => {
    if (!editing) return;
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed !== label) useFlowStore.getState().updateNodeData(id, { label: trimmed });
  };
  const editor = editing ? (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') {
          setEditing(false);
          setValue(label);
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="nodrag nopan w-full px-1 py-0.5 text-center text-xs bg-[var(--fs-surface)] text-[var(--fs-text)] border border-[var(--fs-selection-ring)] rounded outline-none"
    />
  ) : null;
  return { editing, setEditing, editor };
};

export const UmlLifelineNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const { editing, setEditing, editor } = useHeaderEditor(props.id, props.data.label || '');
  return (
    <BaseNodeWrapper {...props} customContent className="!bg-transparent !border-transparent">
      <div className="w-full h-full flex flex-col items-center">
        <div
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="w-full max-w-[150px] px-3 py-1.5 rounded-md border border-[var(--fs-node-border)] bg-[var(--fs-node-bg)] shadow-xs flex items-center justify-center min-h-8"
        >
          {editing ? (
            editor
          ) : (
            <span className="text-xs font-semibold text-[var(--fs-node-text)] truncate">
              {props.data.label || '参与者'}
            </span>
          )}
        </div>
        <div className="flex-1 w-0 border-l-2 border-dashed border-[var(--fs-node-border)]/70 mt-1" />
      </div>
    </BaseNodeWrapper>
  );
};

export const UmlActivationNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => (
  <BaseNodeWrapper {...props} customContent className="!bg-transparent !border-transparent">
    <div className="w-[14px] h-full mx-auto rounded-sm border border-[var(--fs-node-border)] border-x-2 bg-[var(--fs-surface)] opacity-90" />
  </BaseNodeWrapper>
);

const MESSAGE_ARROW_MAP: Record<UmlMessageKind, { dash?: string; open: boolean }> = {
  sync: { open: false },
  async: { open: true },
  return: { dash: '6 4', open: true },
};

export const UmlMessageNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const kind: UmlMessageKind = props.data.messageKind ?? 'sync';
  const arrow = MESSAGE_ARROW_MAP[kind];
  const { editing, setEditing, editor } = useHeaderEditor(props.id, props.data.label || '');
  const lineColor = 'var(--fs-node-text)';
  return (
    <BaseNodeWrapper {...props} customContent className="!bg-transparent !border-transparent">
      <div className="w-full h-full flex flex-col justify-center px-1">
        <div
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="w-full text-center text-[11px] leading-none mb-0.5 text-[var(--fs-node-text)] truncate cursor-text"
        >
          {editing ? (
            <span className="inline-block w-4/5">{editor}</span>
          ) : (
            props.data.label || (kind === 'return' ? '返回' : '消息')
          )}
        </div>
        <svg className="w-full h-2 overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 8">
          <line
            x1="0"
            y1="4"
            x2="94"
            y2="4"
            stroke={lineColor}
            strokeWidth="1.6"
            strokeDasharray={arrow.dash}
            vectorEffect="non-scaling-stroke"
          />
          {arrow.open ? (
            <polyline points="94,0.5 100,4 94,7.5" fill="none" stroke={lineColor} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          ) : (
            <polygon points="94,1 100,4 94,7" fill={lineColor} />
          )}
        </svg>
      </div>
    </BaseNodeWrapper>
  );
};
