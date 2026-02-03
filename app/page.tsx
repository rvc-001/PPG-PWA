'use client';

import { useState, useEffect } from 'react';
import RecordingTab from '@/components/tabs/recording-tab';
import HistoryTab from '@/components/tabs/history-tab';
import ModelTab from '@/components/tabs/model-tab';
import SettingsTab from '@/components/tabs/settings-tab';
import BottomNavigation from '@/components/navigation/bottom-navigation';
import { AppSettingsContext, defaultSettings, type AppSettings } from '@/lib/app-context';

type TabType = 'recording' | 'history' | 'model' | 'settings';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('recording');
  // Removed unused isDarkMode state; theme is now handled by next-themes in SettingsTab/Layout
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    // Load settings from localStorage
    const savedSettings = localStorage.getItem('signalMonitorSettings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setAppSettings(parsed);
        // Apply theme
        // Note: This manual theme application might conflict with next-themes used in SettingsTab.
        // It is kept here to maintain legacy behavior if appSettings.theme is set, 
        // but generally next-themes should handle this automatically.
        applyTheme(parsed.theme || 'dark');
      } catch (error) {
        console.error('[v0] Failed to load settings:', error);
        applyTheme('dark');
      }
    } else {
      // Default to dark mode
      applyTheme('dark');
    }
  }, []);

  const applyTheme = (theme: 'light' | 'dark') => {
    const html = document.documentElement;
    if (theme === 'light') {
      html.classList.remove('dark');
      html.classList.add('light');
    } else {
      html.classList.remove('light');
      html.classList.add('dark');
    }
  };

  const handleUpdateSettings = (newSettings: Partial<AppSettings>) => {
    const updated = { ...appSettings, ...newSettings };
    setAppSettings(updated);
    localStorage.setItem('signalMonitorSettings', JSON.stringify(updated));
    // Apply theme if changed
    if (newSettings.theme) {
      applyTheme(newSettings.theme);
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'recording':
        return <RecordingTab />;
      case 'history':
        return <HistoryTab />;
      case 'model':
        return <ModelTab />;
      case 'settings':
        // Fix: Removed props that do not exist on the component
        return <SettingsTab />;
      default:
        return null;
    }
  };

  return (
    <AppSettingsContext.Provider value={{ settings: appSettings, updateSettings: handleUpdateSettings }}>
      <div className="flex flex-col h-screen bg-background text-foreground">
        {/* Tab Content */}
        <main className="flex-1 overflow-auto pb-20">
          {renderTab()}
        </main>

        {/* Bottom Navigation */}
        <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>
    </AppSettingsContext.Provider>
  );
}