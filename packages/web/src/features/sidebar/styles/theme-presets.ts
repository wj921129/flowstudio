import type { ThemePreset } from './types';
export type { ThemePreset, ThemeTokens } from './types';

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'business-blue',
    title: '商务经典',
    description: '沉稳大气的经典商务蓝配色，适合正式企业与汇报展示',
    tokens: {
      name: '商务经典',
      nodeBg: '#eff6ff',
      nodeBorder: '#2563eb',
      nodeText: '#1e293b',
      accent: '#1d4ed8',
      edgeStroke: '#64748b',
      poolHeaderBg: '#dbeafe',
    },
  },
  {
    id: 'modern-monochrome',
    title: '极简素雅',
    description: '高反差黑白灰极简设计，专注纯粹结构与信息逻辑',
    tokens: {
      name: '极简素雅',
      nodeBg: '#f8fafc',
      nodeBorder: '#334155',
      nodeText: '#0f172a',
      accent: '#0f172a',
      edgeStroke: '#475569',
      poolHeaderBg: '#f1f5f9',
    },
  },
  {
    id: 'fresh-emerald',
    title: '清新薄荷',
    description: '自然温润的翠绿薄荷色系，视觉舒适清爽',
    tokens: {
      name: '清新薄荷',
      nodeBg: '#ecfdf5',
      nodeBorder: '#059669',
      nodeText: '#064e3b',
      accent: '#047857',
      edgeStroke: '#10b981',
      poolHeaderBg: '#d1fae5',
    },
  },
  {
    id: 'cyber-violet',
    title: '科技炫紫',
    description: '前沿现代的紫罗兰与靛蓝色系，凸显数字化与高科技感',
    tokens: {
      name: '科技炫紫',
      nodeBg: '#f5f3ff',
      nodeBorder: '#7c3aed',
      nodeText: '#4c1d95',
      accent: '#6d28d9',
      edgeStroke: '#8b5cf6',
      poolHeaderBg: '#ede9fe',
    },
  },
  {
    id: 'warm-amber',
    title: '活力暖阳',
    description: '温暖活力的暖橙与琥珀黄调，亲和明快引人注目',
    tokens: {
      name: '活力暖阳',
      nodeBg: '#fffbeb',
      nodeBorder: '#d97706',
      nodeText: '#78350f',
      accent: '#b45309',
      edgeStroke: '#f59e0b',
      poolHeaderBg: '#fef3c7',
    },
  },
  {
    id: 'coral-rose',
    title: '珊瑚雅粉',
    description: '柔美优雅的珊瑚玫粉风格，富有艺术感与亲切氛围',
    tokens: {
      name: '珊瑚雅粉',
      nodeBg: '#fff1f2',
      nodeBorder: '#e11d48',
      nodeText: '#881337',
      accent: '#be123c',
      edgeStroke: '#f43f5e',
      poolHeaderBg: '#ffe4e6',
    },
  },
];

export const DEFAULT_THEME_ID = 'business-blue';

export function getThemePreset(themeId?: string): ThemePreset {
  return (
    THEME_PRESETS.find((t) => t.id === themeId) ??
    THEME_PRESETS[0]
  );
}
