import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { ThemeProvider } from '../features/theme/theme-provider';

export interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * 全局 Providers 容器
 * 聚合主题 Provider 与 ReactFlow 画布 Provider
 */
export const Providers: React.FC<ProvidersProps> = ({ children }) => {
  return (
    <ThemeProvider>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </ThemeProvider>
  );
};
