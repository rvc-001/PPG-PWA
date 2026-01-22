'use client';

import { useEffect, useRef, useState, useContext } from 'react';
import { RPPGAcquisition, generateSimulatedSignal } from '@/lib/camera-utils';
import { butterworthBandpass, SignalStorage, RecordingSession, FilterConfig } from '@/lib/signal-processing';
import SignalVisualizer from '@/components/visualization/signal-visualizer';
import { AppSettingsContext } from '@/lib/app-context';
import { Pause, Play, X } from 'lucide-react';

export default function RecordingTab() {
  const { settings } = useContext(AppSettingsContext);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [patientInfo, setPatientInfo] = useState({ id: '', name: '' });
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [signalDuration, setSignalDuration] = useState(0); // Duration in seconds at real-time rate

  const [rawSignal, setRawSignal] = useState<number[]>([]);
  const [filteredSignal, setFilteredSignal] = useState<number[]>([]);

  const rpPgRef = useRef<RPPGAcquisition | null>(null);
  const recordedSamplesRef = useRef<Array<{ timestamp: number; value: number }>>([]);
  const startTimeRef = useRef<number>(0);

  const defaultFilterConfig: FilterConfig = {
    lowCutoff: 0.5,
    highCutoff: 50,
    order: 4,
    samplingRate: 30,
  };

  // Request camera permission on mount
  useEffect(() => {
    const requestCamera = async () => {
      try {
        if (rpPgRef.current === null) {
          rpPgRef.current = new RPPGAcquisition(30);
        }
        const stream = await rpPgRef.current.requestCameraPermission();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraPermission('granted');
      } catch (error) {
        console.error('Camera access denied, using simulated data:', error);
        setCameraPermission('denied');
      }
    };

    requestCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handleStartRecording = () => {
    if (!patientInfo.id && !patientInfo.name) {
      setShowPatientModal(true);
      return;
    }

    setIsRecording(true);
    startTimeRef.current = Date.now();
    recordedSamplesRef.current = [];
    setRawSignal([]);
    setFilteredSignal([]);
    setRecordingTime(0);
    setSignalDuration(0);

    // Calculate interval based on recording speed setting
    // At 1x speed: 1000/30 = 33.33ms per sample (30 Hz)
    // At 0.5x speed: slower acquisition (67ms per sample = 15 Hz effective)
    // At 2x speed: faster acquisition (16.67ms per sample = 60 Hz effective)
    const baseInterval = 1000 / 30; // 30 Hz base
    const adjustedInterval = baseInterval / settings.recordingSpeed;

    recordingIntervalRef.current = setInterval(() => {
      setRecordingTime((t) => t + adjustedInterval / 1000);
      // Calculate signal duration: samples acquired × time per sample at base 30 Hz rate
      setSignalDuration((prev) => prev + (1 / 30));

      // If camera permission denied, use simulated signal
      if (cameraPermission === 'denied' && videoRef.current) {
        const simulated = generateSimulatedSignal(70, 30, 1);
        const newSample = simulated[0];
        recordedSamplesRef.current.push({
          timestamp: Date.now(),
          value: newSample,
        });

        setRawSignal((prev) => [...prev, newSample]);
      } else if (videoRef.current && videoRef.current.videoWidth > 0) {
        // Extract signal from camera
        if (!rpPgRef.current) {
          rpPgRef.current = new RPPGAcquisition(30);
        }
        const signal = rpPgRef.current.extractSignal(videoRef.current);
        recordedSamplesRef.current.push({
          timestamp: Date.now(),
          value: signal,
        });

        setRawSignal((prev) => [...prev, signal]);
      }
    }, 1000 / 30); // 30 Hz sampling
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    // Apply filter to raw signal
    if (rawSignal.length > 0) {
      const filtered = butterworthBandpass(rawSignal, defaultFilterConfig);
      setFilteredSignal(filtered);
    }

    // Save session
    saveSession();
  };

  const saveSession = async () => {
    if (recordedSamplesRef.current.length === 0) return;

    const session: RecordingSession = {
      id: `recording-${Date.now()}`,
      patientId: patientInfo.id,
      patientName: patientInfo.name,
      startTime: startTimeRef.current,
      endTime: Date.now(),
      samplingRate: 30,
      rawSignal: recordedSamplesRef.current,
      filterConfig: defaultFilterConfig,
      createdAt: new Date(),
    };

    try {
      const storage = new SignalStorage();
      await storage.saveSession(session);
      console.log('Session saved:', session.id);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (cameraPermission === 'pending') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">Requesting camera access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col bg-background min-h-screen">
      {/* Camera Preview */}
      <div className="relative bg-black/80 aspect-video flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-cover ${cameraPermission === 'denied' ? 'hidden' : ''}`}
        />
        {cameraPermission === 'denied' && (
          <div className="text-center">
            <p className="text-muted-foreground mb-2">Camera not available</p>
            <p className="text-xs text-muted-foreground">Using simulated signal mode</p>
          </div>
        )}

        {/* Recording Indicator */}
        {isRecording && (
          <div className="absolute top-4 right-4 flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-destructive rounded-full animate-pulse" />
              <span className="text-sm font-semibold text-destructive">Recording</span>
            </div>
            <div className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
              <p>Wall: {formatTime(recordingTime)}</p>
              <p>Signal: {formatTime(signalDuration)} @ {settings.recordingSpeed}x</p>
            </div>
          </div>
        )}
      </div>

      {/* Control Panel */}
      <div className="p-4 bg-card border-b border-border">
        <div className="flex gap-3">
          {!isRecording ? (
            <button
              onClick={handleStartRecording}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
            >
              <Play className="w-5 h-5" />
              Start Recording
            </button>
          ) : (
            <>
              <button
                onClick={handleStopRecording}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-destructive text-destructive-foreground rounded-lg font-semibold hover:bg-destructive/90 transition-colors"
              >
                <Pause className="w-5 h-5" />
                Stop Recording
              </button>
            </>
          )}
        </div>

        {/* Patient Info */}
        {(patientInfo.id || patientInfo.name) && (
          <div className="mt-3 p-3 bg-background rounded border border-border text-sm">
            <p className="text-muted-foreground">Patient: {patientInfo.name || patientInfo.id}</p>
          </div>
        )}
      </div>

      {/* Signal Visualization */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {rawSignal.length > 0 && (
          <>
            <SignalVisualizer
              rawSignal={rawSignal}
              filteredSignal={[]}
              title="Raw Signal"
              color="cyan"
              height={120}
            />
            {filteredSignal.length > 0 && (
              <SignalVisualizer
                rawSignal={[]}
                filteredSignal={filteredSignal}
                title="Filtered Signal (Butterworth Bandpass)"
                color="emerald"
                height={120}
              />
            )}
          </>
        )}

        {!isRecording && rawSignal.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>Start recording to see signal visualization</p>
          </div>
        )}
      </div>

      {/* Patient Modal */}
      {showPatientModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Patient Information</h2>
              <button
                onClick={() => setShowPatientModal(false)}
                className="p-1 hover:bg-background rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Patient ID (optional)</label>
                <input
                  type="text"
                  placeholder="E.g., P12345"
                  value={patientInfo.id}
                  onChange={(e) => setPatientInfo({ ...patientInfo, id: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Patient Name (optional)</label>
                <input
                  type="text"
                  placeholder="E.g., John Doe"
                  value={patientInfo.name}
                  onChange={(e) => setPatientInfo({ ...patientInfo, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                * At least one of Patient ID or Name is required
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  if (patientInfo.id || patientInfo.name) {
                    setShowPatientModal(false);
                    handleStartRecording();
                  }
                }}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
              >
                Start Recording
              </button>
              <button
                onClick={() => setShowPatientModal(false)}
                className="flex-1 px-4 py-2 bg-background border border-border text-foreground rounded-lg font-medium hover:bg-background/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
