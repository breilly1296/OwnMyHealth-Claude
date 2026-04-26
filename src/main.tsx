import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  const lastReload = sessionStorage.getItem('chunk-reload');
  const now = Date.now().toString();
  if (!lastReload || (Date.now() - parseInt(lastReload)) > 10000) {
    sessionStorage.setItem('chunk-reload', now);
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);