'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
  }>;
}

export default function PWARegister() {
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Register service worker from API route with root scope
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/api/sw', { scope: '/' }).catch((error) => {
        console.error('[v0] Service Worker registration failed:', error);
      });
    }

    // Handle install prompt
    const handler = (e: Event) => {
      const event = e as BeforeInstallPromptEvent;
      event.preventDefault();
      setDeferredPrompt(event);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;

    if (result.outcome === 'accepted') {
      console.log('App installed');
    }

    setDeferredPrompt(null);
    setShowInstallPrompt(false);
  };

  // Don't show install prompt in development or if not available
  if (!showInstallPrompt || !deferredPrompt) {
    return null;
  }

  return null; // Install prompt handled by browser native UI
}
