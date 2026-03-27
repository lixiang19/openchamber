import { createWebAPIs } from './api';
import { registerSW } from 'virtual:pwa-register';

import type { RuntimeAPIs } from '@ridge/ui/lib/api/types';
import '@ridge/ui/index.css';
import '@ridge/ui/styles/fonts';

declare global {
  interface Window {
    __RIDGE_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

window.__RIDGE_RUNTIME_APIS__ = createWebAPIs();

if (import.meta.env.PROD) {
  registerSW({
    onRegisterError(error: unknown) {
      console.warn('[PWA] service worker registration failed:', error);
    },
  });
} else if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => {});
}

import('@ridge/ui/main');
