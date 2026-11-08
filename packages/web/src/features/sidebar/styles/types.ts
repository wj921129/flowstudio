export interface ThemeTokens {
  name: string;
  nodeBg: string;
  nodeBorder: string;
  nodeText: string;
  accent: string;
  edgeStroke: string;
  poolHeaderBg: string;
}

export interface ThemePreset {
  id: string;
  title: string;
  description: string;
  tokens: ThemeTokens;
}
