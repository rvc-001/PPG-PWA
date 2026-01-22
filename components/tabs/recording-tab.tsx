'use client';

import { useEffect, useRef, useState, useContext } from 'react';
import { RPPGAcquisition, generateSimulatedSignal } from '@/lib/camera-utils';
import { butterworthBandpass, SignalStorage, RecordingSession, FilterConfig, assessSignalQuality } from '@/lib/signal-processing';
import SignalVisualizer from '@/components/visualization/signal-visualizer';
import { AppSettingsContext } from '@/lib/app-context';
import { Pause, Play, X, Save, Activity } from 'lucide-react';

export default function RecordingTab() {
  const { settings } = useContext(AppSettingsContext);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [patientInfo, setPatientInfo] = useState({ id: '', name: '' });
  
  // Modals
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  // Stats
  const [recordingTime, setRecordingTime] = useState(0);
  const [signalDuration, setSignalDuration] = useState(0);
  const [sampleCount, setSampleCount] = useState(0); // Added Sample Count

  const [rawSignal, setRawSignal] = useState<number[]>([]);
  const [filteredSignal, setFilteredSignal] = useState<number[]>([]);

  // Quality & BP Report
  const [qualityReport, setQualityReport] = useState<'Good' | 'Usable' | 'Bad'>('Bad');
  const [referenceBP, setReferenceBP] = useState({ sbp: 120, dbp: 80 });

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
    setSampleCount(0);

    const baseInterval = 1000 / 30; // 30 Hz base
    const adjustedInterval = baseInterval / settings.recordingSpeed;

    recordingIntervalRef.current = setInterval(() => {
      setRecordingTime((t) => t + adjustedInterval / 1000);
      setSignalDuration((prev) => prev + (1 / 30));

      let newSample = 0;

      // If camera permission denied, use simulated signal
      if (cameraPermission === 'denied' && videoRef.current) {
        const simulated = generateSimulatedSignal(70, 30, 1);
        newSample = simulated[0];
      } else if (videoRef.current && videoRef.current.videoWidth > 0) {
        if (!rpPgRef.current) {
          rpPgRef.current = new RPPGAcquisition(30);
        }
        newSample = rpPgRef.current.extractSignal(videoRef.current);
      }

      recordedSamplesRef.current.push({
        timestamp: Date.now(),
        value: newSample,
      });

      setRawSignal((prev) => [...prev, newSample]);
      setSampleCount(prev => prev + 1);

    }, 1000 / 30);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    // Apply filter to raw signal
    const samples = recordedSamplesRef.current.map(s => s.value);
    if (samples.length > 0) {
      const filtered = butterworthBandpass(samples, defaultFilterConfig);
      setFilteredSignal(filtered);
      
      // Assess Quality
      const quality = assessSignalQuality(samples);
      setQualityReport(quality);
      
      // Open Report Modal
      setShowReportModal(true);
    }
  };

  const handleSaveSession = async () => {
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
      quality: qualityReport,
      sbp: referenceBP.sbp,
      dbp: referenceBP.dbp,
    };

    try {
      const storage = new SignalStorage();
      await storage.saveSession(session);
      console.log('Session saved:', session.id);
      setShowReportModal(false);
      // Optional: clear signals or keep them for review
      setRawSignal([]);
      setFilteredSignal([]);
      setSampleCount(0);
      setRecordingTime(0);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
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
            <div className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded text-right">
              <p>Time: {formatTime(recordingTime)}</p>
              <p>Samples: {sampleCount}</p>
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
              <button onClick={() => setShowPatientModal(false)} className="p-1 hover:bg-background rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Patient ID</label>
                <input
                  type="text"
                  placeholder="E.g., P12345"
                  value={patientInfo.id}
                  onChange={(e) => setPatientInfo({ ...patientInfo, id: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Patient Name</label>
                <input
                  type="text"
                  placeholder="E.g., John Doe"
                  value={patientInfo.name}
                  onChange={(e) => setPatientInfo({ ...patientInfo, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  if (patientInfo.id || patientInfo.name) {
                    setShowPatientModal(false);
                    handleStartRecording();
                  }
                }}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium"
              >
                Start Recording
              </button>
              <button
                onClick={() => setShowPatientModal(false)}
                className="flex-1 px-4 py-2 bg-background border border-border text-foreground rounded-lg font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full shadow-2xl">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">Acquisition Quality</h2>
                <p className="text-sm text-muted-foreground">Session Summary</p>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-bold border ${
                qualityReport === 'Good' ? 'bg-green-500/20 text-green-500 border-green-500/50' :
                qualityReport === 'Usable' ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' :
                'bg-red-500/20 text-red-500 border-red-500/50'
              }`}>
                {qualityReport}
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-4">
                 <div className="bg-background p-3 rounded border border-border">
                   <p className="text-xs text-muted-foreground">Duration</p>
                   <p className="font-mono font-semibold">{formatTime(recordingTime)}</p>
                 </div>
                 <div className="bg-background p-3 rounded border border-border">
                   <p className="text-xs text-muted-foreground">Samples</p>
                   <p className="font-mono font-semibold">{sampleCount}</p>
                 </div>
              </div>

              <div className="space-y-2">
                 <h3 className="font-semibold text-sm flex items-center gap-2">
                   <Activity className="w-4 h-4" /> Reference BP (MIMIC-III)
                 </h3>
                 <div className="grid grid-cols-2 gap-3">
                   <div>
                     <label className="text-xs text-muted-foreground">Systolic (mmHg)</label>
                     <input 
                       type="number" value={referenceBP.sbp} 
                       onChange={e => setReferenceBP({...referenceBP, sbp: Number(e.target.value)})}
                       className="w-full px-2 py-1 mt-1 bg-background border border-border rounded"
                     />
                   </div>
                   <div>
                     <label className="text-xs text-muted-foreground">Diastolic (mmHg)</label>
                     <input 
                       type="number" value={referenceBP.dbp} 
                       onChange={e => setReferenceBP({...referenceBP, dbp: Number(e.target.value)})}
                       className="w-full px-2 py-1 mt-1 bg-background border border-border rounded"
                     />
                   </div>
                 </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSaveSession}
                className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2 rounded-lg font-semibold"
              >
                <Save className="w-4 h-4" /> Save
              </button>
              <button
                onClick={() => { setShowReportModal(false); setRawSignal([]); }}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg font-medium"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}