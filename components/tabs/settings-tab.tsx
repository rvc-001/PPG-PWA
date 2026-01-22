'use client';

import { useContext, useState } from 'react';
import { Moon, Sun, AlertCircle } from 'lucide-react';
import { AppSettingsContext } from '@/lib/app-context';
import { SignalStorage } from '@/lib/signal-processing';

interface SettingsTabProps {
  isDarkMode: boolean;
  setIsDarkMode: (value: boolean) => void;
}

export default function SettingsTab({ isDarkMode, setIsDarkMode }: SettingsTabProps) {
  const { settings, updateSettings } = useContext(AppSettingsContext);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearStatus, setClearStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleFilterUpdate = (field: string, value: number) => {
    const newFilterConfig = {
      ...settings.filterConfig,
      [field]: value,
    };
    updateSettings({ filterConfig: newFilterConfig });
  };

  const handleGraphPreferenceUpdate = (key: string, value: boolean) => {
    updateSettings({
      graphPreferences: {
        ...settings.graphPreferences,
        [key]: value,
      },
    });
  };

  const handleClearData = async () => {
    setClearStatus('loading');
    try {
      const storage = new SignalStorage();
      await storage.clearAll();
      setClearStatus('success');
      setTimeout(() => {
        setClearStatus('idle');
        setShowClearConfirm(false);
      }, 2000);
    } catch (error) {
      console.error('Error clearing data:', error);
      setClearStatus('error');
      setTimeout(() => setClearStatus('idle'), 3000);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-background">
      <div className="p-4 border-b border-border">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-6 pb-24">
          {/* Theme Toggle */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {settings.theme === 'dark' ? (
                  <Moon className="w-5 h-5 text-primary" />
                ) : (
                  <Sun className="w-5 h-5 text-primary" />
                )}
                <div>
                  <h3 className="font-semibold">Theme</h3>
                  <p className="text-sm text-muted-foreground">{settings.theme === 'dark' ? 'Dark mode' : 'Light mode'}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
                  updateSettings({ theme: newTheme });
                }}
                className="relative inline-flex h-8 w-14 items-center rounded-full bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
                role="switch"
                aria-checked={settings.theme === 'dark'}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-background transition-transform ${
                    settings.theme === 'dark' ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Recording Speed Control */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-semibold mb-4">Recording Speed Control</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-2">
                  Playback Speed: {settings.recordingSpeed.toFixed(2)}x
                </label>
                <p className="text-xs text-muted-foreground mb-3">
                  Adjusts how fast signal acquisition runs. 1.0x = real-time physiological data capture.
                </p>
                <div className="flex gap-2">
                  {[0.25, 0.5, 1, 1.5, 2].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => updateSettings({ recordingSpeed: speed })}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        settings.recordingSpeed === speed
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
                <div className="mt-3 p-2 bg-background rounded text-xs text-muted-foreground">
                  <p>
                    <strong>Note:</strong> At 1.0x, a 60-second recording captures 1,800 samples (30 Hz × 60s),
                    matching clinical MIMIC-III standards.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Signal Processing Settings */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <span>Signal Processing</span>
              <span className="text-xs font-normal text-muted-foreground">(Butterworth Filter)</span>
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">
                  Low Cutoff Frequency: {settings.filterConfig.lowCutoff} Hz
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={settings.filterConfig.lowCutoff}
                  onChange={(e) => handleFilterUpdate('lowCutoff', parseFloat(e.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">Removes very low frequency drift</p>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">
                  High Cutoff Frequency: {settings.filterConfig.highCutoff} Hz
                </label>
                <input
                  type="range"
                  min="10"
                  max="500"
                  step="1"
                  value={settings.filterConfig.highCutoff}
                  onChange={(e) => handleFilterUpdate('highCutoff', parseFloat(e.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">Removes high-frequency noise</p>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">
                  Filter Order: {settings.filterConfig.order}
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={settings.filterConfig.order}
                  onChange={(e) => handleFilterUpdate('order', parseInt(e.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">Higher order = steeper rolloff</p>
              </div>

              <p className="text-xs text-muted-foreground px-3 py-2 bg-background rounded border border-border italic">
                Sampling Rate: {settings.filterConfig.samplingRate} Hz (fixed)
              </p>
            </div>
          </div>

          {/* Graph Preferences */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-semibold mb-4">Graph Preferences</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.graphPreferences.showGrid}
                  onChange={(e) => handleGraphPreferenceUpdate('showGrid', e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm">Show grid lines</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.graphPreferences.autoScale}
                  onChange={(e) => handleGraphPreferenceUpdate('autoScale', e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm">Auto-scale graphs</span>
              </label>
            </div>
          </div>

          {/* Data Management */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-semibold mb-4">Data Management</h3>
            {!showClearConfirm ? (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full px-4 py-2 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-md transition-colors text-sm font-medium"
              >
                Clear All Local Data
              </button>
            ) : (
              <div className="space-y-3 p-3 bg-destructive/10 rounded-md border border-destructive/30">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-sm">This will permanently delete all recorded sessions. This action cannot be undone.</p>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleClearData}
                    disabled={clearStatus === 'loading'}
                    className="flex-1 px-3 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {clearStatus === 'loading' ? 'Clearing...' : 'Yes, Clear Data'}
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    disabled={clearStatus === 'loading'}
                    className="flex-1 px-3 py-2 bg-background border border-border text-foreground hover:bg-background/80 rounded-md text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {clearStatus === 'success' && (
                  <p className="text-xs text-accent text-center">Data cleared successfully</p>
                )}
                {clearStatus === 'error' && (
                  <p className="text-xs text-destructive text-center">Error clearing data</p>
                )}
              </div>
            )}
          </div>

          {/* App Info */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-semibold mb-2">About</h3>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>Signal Monitor v1.0</p>
              <p>Medical-grade physiological signal acquisition and analysis</p>
              <p>MIMIC-III aligned data format</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
