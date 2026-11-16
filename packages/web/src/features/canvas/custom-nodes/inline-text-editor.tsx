import React, { useEffect, useRef } from 'react';

interface InlineTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
  wrapperClassName?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}

export const InlineTextEditor: React.FC<InlineTextEditorProps> = ({
  value,
  onChange,
  onCommit,
  onCancel,
  className = '',
  wrapperClassName = '',
  style,
  placeholder,
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const mirrorText = (value || placeholder || ' ') + (value.endsWith('\n') ? '\u200b' : '');

  return (
    <div className={`nodrag nopan nowheel inline-grid items-center ${wrapperClassName}`}>
      <span
        aria-hidden="true"
        className={`invisible whitespace-pre-wrap break-words col-start-1 row-start-1 pointer-events-none ${className}`}
        style={style}
      >
        {mirrorText}
      </span>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onCommit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={`nodrag nopan nowheel col-start-1 row-start-1 w-full h-full min-w-0 min-h-0 resize-none overflow-hidden bg-transparent outline-none border-none m-0 ${className}`}
        style={style}
      />
    </div>
  );
};
