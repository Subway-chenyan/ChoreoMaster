import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AppEntry } from './mobile/entry';
import { ThemeProvider } from './contexts/ThemeContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <AppEntry />
    </ThemeProvider>
  </React.StrictMode>
);
