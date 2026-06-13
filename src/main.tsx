import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { enforceTopLevel } from './utils/frameGuard';

window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  const lastReload = sessionStorage.getItem('chunk-reload');
  const now = Date.now().toString();
  if (!lastReload || (Date.now() - parseInt(lastReload)) > 10000) {
    sessionStorage.setItem('chunk-reload', now);
    window.location.reload();
  }
});

// Clickjacking defense-in-depth (M16/L14): the GCS-served SPA can't emit a real
// X-Frame-Options / frame-ancestors header (edge-only). If we're framed, break
// out and don't mount the authenticated UI. See utils/frameGuard.ts.
if (!enforceTopLevel()) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}