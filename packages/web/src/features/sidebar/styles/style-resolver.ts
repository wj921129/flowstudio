import type { FlowNodeType } from '@flowstudio/shared';
import type { ThemePreset } from './types';

export type NodeSemanticRole = 'start' | 'process' | 'end' | 'neutral';

export function resolveNodeSemanticRole(
  id: string,
  type: FlowNodeType | string,
  label: string | undefined,
  edges: ReadonlyArray<{ source: string; target: string }>
): NodeSemanticRole {
  if (type === 'comment' || type === 'pool' || type === 'lane' || type === 'group') {
    return 'neutral';
  }
  if (type === 'start-end') {
    let inCount = 0;
    let outCount = 0;
    for (const e of edges) {
      if (e.target === id) inCount += 1;
      if (e.source === id) outCount += 1;
    }
    if (inCount === 0 && outCount > 0) return 'start';
    if (outCount === 0 && inCount > 0) return 'end';
    if (label && /结束|完成|归档|终止|失败|关闭|end|finish|done|complete/i.test(label)) {
      return 'end';
    }
    return 'start';
  }
  if (type === 'process' || type === 'subprocess') {
    return 'process';
  }
  return 'neutral';
}

export interface ResolvedNodeStyle {
  fillColor: string;
  borderColor: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed';
  fontColor: string;
  headerColor?: string;
}

export function resolveNodeStyle(
  nodeType: string,
  theme: ThemePreset,
  semanticRole?: NodeSemanticRole
): ResolvedNodeStyle {
  if (nodeType === 'comment') {
    return {
      fillColor: '#fef9c3',
      borderColor: '#ca8a04',
      borderWidth: 1.5,
      borderStyle: 'solid',
      fontColor: '#854d0e',
    };
  }

  if (nodeType === 'pool') {
    return {
      fillColor: 'transparent',
      borderColor: theme.tokens.nodeBorder,
      borderWidth: 1.5,
      borderStyle: 'solid',
      fontColor: theme.tokens.nodeText,
      headerColor: theme.tokens.poolHeaderBg,
    };
  }

  if (nodeType === 'lane') {
    return {
      fillColor: 'rgba(255, 255, 255, 0.4)',
      borderColor: theme.tokens.edgeStroke,
      borderWidth: 1,
      borderStyle: 'solid',
      fontColor: theme.tokens.nodeText,
    };
  }

  if (nodeType === 'start-end') {
    const isEnd = semanticRole === 'end';
    return {
      fillColor: isEnd ? theme.tokens.endBg : theme.tokens.startBg,
      borderColor: isEnd ? theme.tokens.endBorder : theme.tokens.startBorder,
      borderWidth: 1.5,
      borderStyle: 'solid',
      fontColor: isEnd ? theme.tokens.endText : theme.tokens.startText,
    };
  }

  return {
    fillColor: theme.tokens.nodeBg,
    borderColor: theme.tokens.nodeBorder,
    borderWidth: 1.5,
    borderStyle: 'solid',
    fontColor: theme.tokens.nodeText,
  };
}
