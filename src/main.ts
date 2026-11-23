import './style.css';
import { startApp } from './app';

startApp().catch((err: unknown) => {
  const fatal = document.getElementById('fatal');
  if (fatal) {
    fatal.textContent = err instanceof Error ? err.message : String(err);
    fatal.hidden = false;
  }
  throw err;
});

// Offline support: only for real builds served over HTTPS (or localhost).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Not fatal: the app simply needs the network to load.
    });
  });
}
