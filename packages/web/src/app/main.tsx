import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '../features/theme/tokens.css';
import { VERSION } from '@flowstudio/shared';
import { App } from './app';

console.log(`FlowStudio version: ${VERSION}`);

const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
