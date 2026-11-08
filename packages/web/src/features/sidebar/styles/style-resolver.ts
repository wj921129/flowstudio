import type { ThemePreset } from './types';

export interface ResolvedNodeStyle {
  fillColor: string;
  borderColor: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontColor: string;
  headerColor?: string;
}

export function resolveNodeStyle(
  nodeType: string,
  theme: ThemePreset
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

  return {
    fillColor: theme.tokens.nodeBg,
    borderColor: theme.tokens.nodeBorder,
    borderWidth: 1.5,
    borderStyle: 'solid',
    fontColor: theme.tokens.nodeText,
  };
}
