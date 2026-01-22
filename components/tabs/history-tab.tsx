'use client';

import { useEffect, useState } from 'react';
import { RecordingSession, SignalStorage, generateMIMICCSV, calculateSignalStats } from '@/lib/signal-processing';
import SignalVisualizer from '@/components/visualization/signal-visualizer';
import { Trash2, Download, Clock, User, ChevronLeft } from 'lucide-react';

type ViewMode = 'list' | 'detail';

export default function HistoryTab() {
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedSession, setSelectedSession] = useState<RecordingSession | null>(null);
  const [clipStart, setClipStart] = useState<number | undefined>();
  const [clipEnd, setClipEnd] = useState<number | undefined>();

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const storage = new SignalStorage();
      const data = await storage.getSessions();
      // Sort by creation date, newest first
      setSessions(data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    } catch (error) {
      console.error('Error loading sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSession = (session: RecordingSession) => {
    setSelectedSession(session);
    setClipStart(session.startTime);
    setClipEnd(session.endTime);
    setViewMode('detail');
  };

  const handleDeleteSession = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this recording?')) return;

    try {
      const storage = new SignalStorage();
      await storage.deleteSession(id);
      setSessions(sessions.filter((s) => s.id !== id));
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  };

  const handleExportSession = () => {
    if (!selectedSession) return;

    const csv = generateMIMICCSV(selectedSession, clipStart, clipEnd);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const filename = `signal_${selectedSession.patientId || selectedSession.patientName || 'export'}_${new Date(selectedSession.startTime).toISOString().slice(0, 10)}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDuration = (start: number, end?: number) => {
    const duration = Math.floor(((end || Date.now()) - start) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}m ${seconds}s`;
  };

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">Loading sessions...</p>
        </div>
      </div>
    );
  }

  // Detail View
  if (viewMode === 'detail' && selectedSession) {
    const rawSignalData = selectedSession.rawSignal.map((s) => s.value);
    const filteredSignalData = selectedSession.rawSignal
      ? selectedSession.rawSignal
          .filter((s) => (!clipStart || s.timestamp >= clipStart) && (!clipEnd || s.timestamp <= clipEnd))
          .map((s) => s.value)
      : [];

    return (
      <div className="w-full flex flex-col bg-background min-h-screen">
        {/* Header */}
        <div className="p-4 border-b border-border bg-card">
          <button
            onClick={() => setViewMode('list')}
            className="flex items-center gap-2 text-primary hover:text-primary/80 mb-3 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            Back to Sessions
          </button>

          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <User className="w-5 h-5" />
              {selectedSession.patientName || selectedSession.patientId || 'Unknown Patient'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              <Clock className="w-4 h-4 inline mr-1" />
              {formatDate(selectedSession.startTime)}
            </p>
          </div>
        </div>

        {/* Session Statistics */}
        <div className="p-4 bg-card border-b border-border">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background rounded p-3">
              <p className="text-xs text-muted-foreground">Duration</p>
              <p className="text-sm font-semibold">{getDuration(selectedSession.startTime, selectedSession.endTime)}</p>
            </div>
            <div className="bg-background rounded p-3">
              <p className="text-xs text-muted-foreground">Samples</p>
              <p className="text-sm font-semibold">{selectedSession.rawSignal.length}</p>
            </div>
            <div className="bg-background rounded p-3">
              <p className="text-xs text-muted-foreground">Sampling Rate</p>
              <p className="text-sm font-semibold">{selectedSession.samplingRate} Hz</p>
            </div>
            <div className="bg-background rounded p-3">
              <p className="text-xs text-muted-foreground">Filter</p>
              <p className="text-xs font-semibold">
                {selectedSession.filterConfig.lowCutoff}-{selectedSession.filterConfig.highCutoff} Hz
              </p>
            </div>
          </div>
        </div>

        {/* Clipping Controls */}
        <div className="p-4 bg-card border-b border-border space-y-3">
          <h3 className="font-semibold text-sm">Clip Selection</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Start (ms)</label>
              <input
                type="number"
                value={clipStart || selectedSession.startTime}
                onChange={(e) => setClipStart(parseInt(e.target.value))}
                className="w-full px-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">End (ms)</label>
              <input
                type="number"
                value={clipEnd || selectedSession.endTime}
                onChange={(e) => setClipEnd(parseInt(e.target.value))}
                className="w-full px-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Clipped duration: {clipStart && clipEnd ? getDuration(clipStart, clipEnd) : 'N/A'}
          </p>
        </div>

        {/* Visualizations */}
        <div className="flex-1 overflow-auto p-4 space-y-4 pb-24">
          <SignalVisualizer
            rawSignal={rawSignalData}
            filteredSignal={[]}
            title="Raw Signal"
            color="cyan"
            height={140}
          />
          <SignalVisualizer
            rawSignal={[]}
            filteredSignal={filteredSignalData}
            title="Filtered Signal"
            color="emerald"
            height={140}
          />

          {/* Signal Statistics */}
          {filteredSignalData.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-semibold text-sm mb-3">Signal Statistics</h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {(() => {
                  const stats = calculateSignalStats(filteredSignalData);
                  return (
                    <>
                      <div className="bg-background rounded p-2">
                        <p className="text-muted-foreground">Min</p>
                        <p className="font-semibold">{stats.min.toFixed(4)}</p>
                      </div>
                      <div className="bg-background rounded p-2">
                        <p className="text-muted-foreground">Max</p>
                        <p className="font-semibold">{stats.max.toFixed(4)}</p>
                      </div>
                      <div className="bg-background rounded p-2">
                        <p className="text-muted-foreground">Mean</p>
                        <p className="font-semibold">{stats.mean.toFixed(4)}</p>
                      </div>
                      <div className="bg-background rounded p-2">
                        <p className="text-muted-foreground">Std Dev</p>
                        <p className="font-semibold">{stats.std.toFixed(4)}</p>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Export Controls */}
        <div className="fixed bottom-20 left-0 right-0 p-4 bg-card border-t border-border flex gap-2">
          <button
            onClick={handleExportSession}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
          >
            <Download className="w-5 h-5" />
            Export CSV
          </button>
          <button
            onClick={() => handleDeleteSession(selectedSession.id)}
            className="px-4 py-3 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="w-full flex flex-col bg-background min-h-screen">
      <div className="p-4 border-b border-border">
        <h1 className="text-2xl font-bold">Session History</h1>
        <p className="text-sm text-muted-foreground mt-1">{sessions.length} recordings</p>
      </div>

      {sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <p className="text-muted-foreground mb-2">No recorded sessions yet</p>
            <p className="text-sm text-muted-foreground">Start a recording to see your history here</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto pb-20">
          <div className="p-4 space-y-3">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => handleSelectSession(session)}
                className="w-full p-4 bg-card border border-border rounded-lg hover:border-primary/50 hover:bg-card/80 transition-colors text-left"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold flex items-center gap-2">
                      <User className="w-4 h-4 text-primary" />
                      {session.patientName || session.patientId || 'Unknown Patient'}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatDate(session.startTime)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{getDuration(session.startTime, session.endTime)}</p>
                    <p className="text-xs text-muted-foreground">{session.rawSignal.length} samples</p>
                  </div>
                </div>

                {/* Session Details */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded">
                    {session.samplingRate} Hz
                  </span>
                  <span className="px-2 py-1 text-xs bg-accent/10 text-accent rounded">
                    {session.filterConfig.lowCutoff}-{session.filterConfig.highCutoff} Hz
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
