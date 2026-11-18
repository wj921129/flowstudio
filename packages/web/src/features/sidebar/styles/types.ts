export interface ThemeTokens {
  name: string;
  nodeBg: string;
  nodeBorder: string;
  nodeText: string;
  startBg: string;
  startBorder: string;
  startText: string;
  endBg: string;
  endBorder: string;
  endText: string;
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
