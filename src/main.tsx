import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { initializeColorMode } from './ui/color-mode';
import { WindowTitleBar } from './ui/WindowTitleBar';
import './ui/themes.css';
import './ui/styles.css';
import './ui/interaction-controls.css';
initializeColorMode();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WindowTitleBar />
    <App />
  </React.StrictMode>
);
