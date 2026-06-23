import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistration().then((registration) => {
    if (registration) {
      void navigator.serviceWorker.register('./sw.js').catch((error) => {
        console.warn('Legacy PWA cleanup service worker failed:', error);
      });
    }
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((item) => void item.update());
    });
  });
  if ('caches' in window) {
    void caches.keys().then((keys) => {
      keys
        .filter((key) => key.startsWith('choreomaster-') || key.startsWith('cosstage-'))
        .forEach((key) => void caches.delete(key));
    });
  }
}
