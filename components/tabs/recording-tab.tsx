'use client';

import { useEffect, useRef, useState, useContext } from 'react';
import { RPPGAcquisition, generateSimulatedSignal } from '@/lib/camera-utils';
import { RealTimeFilter, SignalStorage, RecordingSession, FilterConfig, assessSignalQuality, estimateBloodPressure } from '@/lib/signal-processing';
import SignalVisualizer from '@/components/visualization/signal-visualizer';
import { AppSettingsContext } from '@/lib/app-context';
import { Pause, Play, Save, Activity, AlertTriangle } from 'lucide-react';

export default function RecordingTab() {
  const { settings } = useContext(AppSettingsContext);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [cameraError, setCameraError] = useState<string>('');
  
  const [patientInfo, setPatientInfo] = useState({ id: '', name: '' });
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  const [recordingTime, setRecordingTime] = useState(0);
  const [sampleCount, setSampleCount] = useState(0);

  const [visRaw, setVisRaw] = useState<number[]>([]);
  const [visFiltered, setVisFiltered] = useState<number[]>([]);

  const recordedSamplesRef = useRef<Array<{ timestamp: number; value: number }>>([]);
  const startTimeRef = useRef<number>(0);
  const rpPgRef = useRef<RPPGAcquisition | null>(null);
  const filterRef = useRef<RealTimeFilter | null>(null);

  const [qualityReport, setQualityReport] = useState<'Good' | 'Usable' | 'Bad'>('Bad');
  const [estimatedBP, setEstimatedBP] = useState({ sbp: 0, dbp: 0, hr: 0 });

  useEffect(() => {
    filterRef.current = new RealTimeFilter();
    
    // Auto-init camera logic
    const initCamera = async () => {
      try {
        if (!rpPgRef.current) rpPgRef.current = new RPPGAcquisition(30);
        
        // This will request Rear Camera + Torch
        const stream = await rpPgRef.current.requestCameraPermission();
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // IMPORTANT: Must wait for loadedmetadata to play on some mobile
          videoRef.current.onloadedmetadata = () => {
             videoRef.current?.play().catch(e => console.error("Play error:", e));
          };
        }
        setCameraPermission('granted');
        setCameraError('');
      } catch (error: any) {
        console.error('Camera init error:', error);
        setCameraPermission('denied');
        
        if (error.name === 'NotAllowedError') {
          setCameraError('Permission denied. Please allow camera access in browser settings.');
        } else if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
           setCameraError('Secure Context Required. App must be served over HTTPS.');
        } else {
           setCameraError('Could not access rear camera or torch. ' + error.message);
        }
      }
    };

    initCamera();

    return () => { 
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); 
    };
  }, []);

  const handleStartRecording = () => {
    if (!patientInfo.id && !patientInfo.name) { setShowPatientModal(true); return; }

    setIsRecording(true);
    startTimeRef.current = Date.now();
    recordedSamplesRef.current = [];
    setVisRaw([]);
    setVisFiltered([]);
    setRecordingTime(0);
    setSampleCount(0);
    setEstimatedBP({ sbp: 0, dbp: 0, hr: 0 });
    
    if (filterRef.current) filterRef.current.reset();

    const intervalMs = 1000 / 30; 

    recordingIntervalRef.current = setInterval(() => {
      setRecordingTime(t => t + (intervalMs / 1000));
      let rawVal = 0;

      if (cameraPermission === 'denied' || !videoRef.current) {
        rawVal = generateSimulatedSignal(70, 30, 1)[0] + 100;
      } else {
        if (!rpPgRef.current) rpPgRef.current = new RPPGAcquisition(30);
        rawVal = rpPgRef.current.extractSignal(videoRef.current);
      }

      const filteredVal = filterRef.current ? filterRef.current.process(rawVal) : rawVal;

      recordedSamplesRef.current.push({ timestamp: Date.now(), value: rawVal });
      setSampleCount(c => {
         const newCount = c + 1;
         // Live BP (every ~2s)
         if (newCount % 60 === 0) {
            const recent = recordedSamplesRef.current.slice(-150).map(s => s.value);
            const tempFilter = new RealTimeFilter();
            // Fast warmup
            for(let i=0; i<5; i++) tempFilter.process(recent[0]);
            const cleanRecent = recent.map(v => tempFilter.process(v));
            
            const est = estimateBloodPressure(cleanRecent, 30);
            if (est.hr > 40 && est.hr < 180) setEstimatedBP(est);
         }
         return newCount;
      });

      setVisRaw(prev => [...prev, rawVal].slice(-300));
      setVisFiltered(prev => [...prev, filteredVal].slice(-300));

    }, intervalMs);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    
    const fullData = recordedSamplesRef.current.map(s => s.value);
    
    // Final high-quality processing
    const filter = new RealTimeFilter();
    const cleanSignal = fullData.map(v => filter.process(v));
    
    setQualityReport(assessSignalQuality(cleanSignal));
    setEstimatedBP(estimateBloodPressure(cleanSignal, 30));
    setShowReportModal(true);
  };

  const handleSaveSession = async () => {
    const session: RecordingSession = {
      id: `rec-${Date.now()}`,
      patientId: patientInfo.id,
      patientName: patientInfo.name,
      startTime: startTimeRef.current,
      endTime: Date.now(),
      samplingRate: 30,
      rawSignal: recordedSamplesRef.current,
      filterConfig: { samplingRate: 30 },
      createdAt: new Date(),
      quality: qualityReport,
      sbp: estimatedBP.sbp,
      dbp: estimatedBP.dbp
    };
    await new SignalStorage().saveSession(session);
    setShowReportModal(false);
    setVisRaw([]); setVisFiltered([]); setSampleCount(0);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full flex flex-col bg-background min-h-screen">
      <div className="relative bg-black/80 aspect-video flex items-center justify-center overflow-hidden">
        {/* VIDEO ELEMENT: Essential attributes for iOS/Mobile */}
        <video 
            ref={videoRef} 
            autoPlay 
            playsInline // CRITICAL FOR IOS
            muted // CRITICAL FOR AUTOPLAY
            className={`w-full h-full object-cover ${cameraPermission === 'denied' ? 'hidden' : ''}`} 
        />
        
        {/* Permission / HTTPS Error Overlay */}
        {cameraPermission === 'denied' && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center">
             <AlertTriangle className="w-12 h-12 text-yellow-500 mb-2" />
             <p className="text-white font-bold mb-1">Camera Error</p>
             <p className="text-sm text-gray-300">{cameraError || "Check permissions and HTTPS"}</p>
           </div>
        )}

        {isRecording && (
          <div className="absolute top-4 right-4 flex flex-col items-end gap-2 z-20">
            <div className="bg-black/50 p-2 rounded backdrop-blur-sm text-white font-mono font-bold">{formatTime(recordingTime)}</div>
            {estimatedBP.hr > 0 && (
               <div className="bg-emerald-500/90 p-2 rounded backdrop-blur-sm text-xs text-white font-bold">
                  HR: {estimatedBP.hr} | {estimatedBP.sbp}/{estimatedBP.dbp}
               </div>
            )}
            <div className="bg-black/50 p-2 rounded backdrop-blur-sm text-xs text-gray-300">
               <Activity className="w-3 h-3 inline mr-1" /> {sampleCount}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-card border-b border-border">
        {!isRecording ? (
          <button onClick={handleStartRecording} className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90">
            <Play className="w-6 h-6 fill-current" /> START ACQUISITION
          </button>
        ) : (
          <button onClick={handleStopRecording} className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-destructive text-destructive-foreground rounded-xl font-bold hover:bg-destructive/90 animate-pulse">
            <Pause className="w-6 h-6 fill-current" /> STOP & ANALYZE
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {visRaw.length > 0 ? (
          <>
            <SignalVisualizer rawSignal={[]} filteredSignal={visFiltered} title="Filtered (Pulse)" color="emerald" height={140} />
            <SignalVisualizer rawSignal={visRaw} filteredSignal={[]} title="Raw Input" color="cyan" height={100} />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground border-2 border-dashed border-border rounded-xl"><p>Ready to acquire signal</p></div>
        )}
      </div>

      {showReportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Session Report</h2>
              <span className={`px-3 py-1 text-xs font-bold border rounded-full ${qualityReport === 'Good' ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}`}>{qualityReport} Quality</span>
            </div>
            
            <div className="bg-secondary/20 p-4 rounded-lg mb-6 border border-secondary">
               <h3 className="font-bold text-sm mb-3 flex items-center gap-2"><Activity className="w-4 h-4"/> Estimated Vitals</h3>
               <div className="grid grid-cols-3 gap-2 text-center">
                 <div className="bg-background p-2 rounded"><p className="text-xs text-muted-foreground">SBP</p><p className="font-mono font-bold text-lg">{estimatedBP.sbp}</p></div>
                 <div className="bg-background p-2 rounded"><p className="text-xs text-muted-foreground">DBP</p><p className="font-mono font-bold text-lg">{estimatedBP.dbp}</p></div>
                 <div className="bg-background p-2 rounded"><p className="text-xs text-muted-foreground">HR</p><p className="font-mono font-bold text-lg">{estimatedBP.hr}</p></div>
               </div>
            </div>

            <div className="space-y-4 mb-6">
               <h3 className="font-semibold text-sm">Calibration / Reference</h3>
               <div className="grid grid-cols-2 gap-4">
                 <div><label className="text-xs block mb-1">Systolic</label><input type="number" value={estimatedBP.sbp} onChange={e=>setEstimatedBP({...estimatedBP, sbp: +e.target.value})} className="w-full bg-background border rounded p-2" /></div>
                 <div><label className="text-xs block mb-1">Diastolic</label><input type="number" value={estimatedBP.dbp} onChange={e=>setEstimatedBP({...estimatedBP, dbp: +e.target.value})} className="w-full bg-background border rounded p-2" /></div>
               </div>
            </div>

            <div className="flex gap-3">
              <button onClick={handleSaveSession} className="flex-1 bg-primary text-primary-foreground py-3 rounded-lg font-bold flex justify-center gap-2"><Save className="w-4 h-4" /> Save</button>
              <button onClick={()=>{setShowReportModal(false); setVisRaw([]);}} className="px-4 bg-secondary text-secondary-foreground rounded-lg">Discard</button>
            </div>
          </div>
        </div>
      )}

      {showPatientModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full space-y-4">
             <h3 className="font-bold">New Session</h3>
             <input placeholder="Patient ID" value={patientInfo.id} onChange={e=>setPatientInfo({...patientInfo, id: e.target.value})} className="w-full bg-background border rounded p-2"/>
             <input placeholder="Patient Name" value={patientInfo.name} onChange={e=>setPatientInfo({...patientInfo, name: e.target.value})} className="w-full bg-background border rounded p-2"/>
             <div className="flex gap-2">
               <button onClick={()=>{if(patientInfo.id || patientInfo.name) {setShowPatientModal(false); handleStartRecording();}}} className="flex-1 bg-primary text-primary-foreground py-2 rounded">Start</button>
               <button onClick={()=>setShowPatientModal(false)} className="flex-1 bg-secondary text-secondary-foreground py-2 rounded">Cancel</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}