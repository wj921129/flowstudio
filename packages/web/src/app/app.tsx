import React from 'react';
import { VERSION } from '@flowstudio/shared';

export const App: React.FC = () => {
  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1>FlowStudio</h1>
      <p>Collaborative Diagramming Platform</p>
      <p>
        Core Shared Version: <code>{VERSION}</code>
      </p>
    </div>
  );
};
