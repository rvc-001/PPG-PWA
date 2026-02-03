'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Upload, TrendingUp, FileCode, Layers, Play, AlertCircle, RotateCcw, Settings2, Wand2, Activity } from 'lucide-react';
import { RecordingSession, SignalStorage, applyFilterToArray } from '@/lib/signal-processing';
import * as ort from 'onnxruntime-web';

// --- CONFIGURATION ---
// 1. Point to public root for WASM files
// 2. Remove 'numThreads = 1' to allow utilizing the threaded WASM file you have
if (typeof window !== 'undefined') {
  ort.env.wasm.wasmPaths = "/"; 
  // We do NOT set numThreads here, allowing it to auto-detect the available threaded backend
}

interface InferenceResult {
  predictedSBP: number;
  predictedDBP: number;
  mae: number;
  actualSBP: number;
  actualDBP: number;
  inferenceTimeMs: number;
  details: string;
}

export default function ModelTab() {
  const [session, setSession] = useState<ort.InferenceSession | null>(null);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0); 
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- CONFIG STATE (Visible) ---
  const [windowSize, setWindowSize] = useState<number>(1250);
  const [inputMode, setInputMode] = useState<'FLAT' | 'CH_1' | 'CH_2'>('FLAT');
  const [isAutoConfigured, setIsAutoConfigured] = useState(false);
  
  // Manual Ground Truth Overrides
  const [manualSBP, setManualSBP] = useState<number | ''>('');
  const [manualDBP, setManualDBP] = useState<number | ''>('');

  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { loadSessions(); }, []);

  const addLog = (msg: string) => setLogs(p => [...p, `> ${msg}`]);

  const loadSessions = async () => {
    try {
      const storage = new SignalStorage();
      const data = await storage.getSessions();
      setSessions(data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    } catch (e) { console.error(e); }
  };

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset State
    setErrorMsg(null);
    setInferenceResult(null);
    setIsAutoConfigured(false);
    setSession(null);
    setLogs([]);

    if (!file.name.endsWith('.onnx')) {
      setErrorMsg("Invalid file. Please upload a .onnx model.");
      return;
    }

    addLog(`Reading ${file.name}...`);
    setIsRunning(true);

    try {
      // CHECK: Environment Capabilities
      if (typeof SharedArrayBuffer === 'undefined') {
        addLog("WARN: SharedArrayBuffer not available. Threaded WASM may fail.");
      }

      const buffer = await file.arrayBuffer();
      
      // Attempt Session Creation
      addLog("Initializing ONNX Backend...");
      const s = await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'], 
        graphOptimizationLevel: 'all',
      });

      setSession(s);
      
      // --- AUTO-DETECTION LOGIC ---
      try {
        const inputName = s.inputNames[0];
        // @ts-ignore
        const meta = s.inputMetadata?.[inputName] || {}; 
        const dims = meta.dimensions || [];
        addLog(`Metadata Shape: [${dims.join(', ')}]`);

        let detectedSize = 1250; 
        let detectedMode: 'FLAT' | 'CH_1' | 'CH_2' = 'FLAT';
        let foundConfig = false;

        // Extract largest dimension as Time Steps
        const largestDim = Math.max(...(dims.filter((d:any) => typeof d === 'number') as number[]));
        if (largestDim > 10) {
          detectedSize = largestDim;
          foundConfig = true;
        }

        // Infer Mode
        if (dims.length === 3) {
           const channelDim = dims[1]; 
           if (channelDim === 2) detectedMode = 'CH_2';
           else detectedMode = 'CH_1'; 
        }

        setWindowSize(detectedSize);
        setInputMode(detectedMode);
        setIsAutoConfigured(foundConfig);

        if (foundConfig) addLog(`✅ Auto-Set: ${detectedMode} / ${detectedSize}`);
        else addLog(`⚠️ Shape ambiguous. Using defaults.`);

      } catch (metaErr) {
        console.warn("Metadata read error", metaErr);
        addLog("Could not read metadata. Please configure manually below.");
      }

    } catch (err) {
      const msg = (err as Error).message;
      setErrorMsg(`Model Load Failed: ${msg}`);
      addLog(`FATAL ERROR: ${msg}`);
      addLog("Tip: Check if 'ort-wasm.wasm' is in /public or if headers are enabled.");
    } finally {
      setIsRunning(false);
    }
  };

  const createTensor = (data: Float32Array, size: number, mode: string) => {
    const fresh = new Float32Array(data.slice(0, size));
    if (mode === 'FLAT') return new ort.Tensor('float32', fresh, [1, size]);
    if (mode === 'CH_1') return new ort.Tensor('float32', fresh, [1, 1, size]);
    
    // CH_2: Duplicate signal
    const dual = new Float32Array(size * 2);
    dual.set(fresh); dual.set(fresh, size);
    return new ort.Tensor('float32', dual, [1, 2, size]);
  };

  const runInference = async () => {
    if (!session || !selectedSessionId) return;
    setIsRunning(true);
    setInferenceResult(null);
    setErrorMsg(null);
    setProgress(0);

    try {
      // 1. Prepare Data
      const storage = new SignalStorage();
      let record = await storage.getSession(selectedSessionId);
      if (!record) record = sessions.find(s => s.id === selectedSessionId);
      if (!record) throw new Error("Recording not found");

      const fullSignal = new Float32Array(applyFilterToArray(record.rawSignal.map(s => s.value)));
      const actualSBP = manualSBP !== '' ? Number(manualSBP) : (record.sbp || 120);
      const actualDBP = manualDBP !== '' ? Number(manualDBP) : (record.dbp || 80);

      if (fullSignal.length < windowSize) throw new Error(`Recording (${fullSignal.length}) too short for model (${windowSize}).`);

      // 2. Inference Loop
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      const stride = Math.max(1, Math.floor(windowSize / 4));
      const predictions = [];
      const startTime = performance.now();

      for (let i = 0; i <= fullSignal.length - windowSize; i += stride) {
        if (i % (stride * 5) === 0) {
            setProgress(Math.round((i / (fullSignal.length - windowSize)) * 100));
            await new Promise(r => setTimeout(r, 0)); 
        }
        
        const tensor = createTensor(fullSignal.slice(i, i + windowSize), windowSize, inputMode);
        const results = await session.run({ [inputName]: tensor });
        const out = results[outputName].data as Float32Array;
        
        predictions.push({ s: out[0] || 120, d: out[1] || (out.length > 2 ? out[2] : 80) });
      }

      if (!predictions.length) throw new Error("No valid windows found.");

      // 3. Results
      const avgS = predictions.reduce((sum, p) => sum + p.s, 0) / predictions.length;
      const avgD = predictions.reduce((sum, p) => sum + p.d, 0) / predictions.length;
      const mae = (Math.abs(avgS - actualSBP) + Math.abs(avgD - actualDBP)) / 2;

      setInferenceResult({
        predictedSBP: Math.round(avgS),
        predictedDBP: Math.round(avgD),
        mae: Number(mae.toFixed(2)),
        actualSBP, actualDBP,
        inferenceTimeMs: performance.now() - startTime,
        details: `Processed ${predictions.length} windows`
      });

    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setIsRunning(false);
      setProgress(100);
    }
  };

  return (
    <div className="flex flex-col h-screen max-h-[80vh] bg-background">
      <div className="p-4 border-b border-border">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wand2 className="w-6 h-6 text-primary"/> Model Analysis
        </h1>
        <p className="text-xs text-muted-foreground">Upload ONNX • Verify Config • Run</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {errorMsg && (
          <div className="bg-destructive/15 text-destructive p-3 rounded-md flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <span className="font-semibold text-sm">{errorMsg}</span>
          </div>
        )}

        {/* UPLOAD SECTION */}
        <div className="bg-card border border-border rounded-lg p-6 border-dashed text-center">
          {!session ? (
             <label className="cursor-pointer flex flex-col items-center p-4 hover:bg-accent/5 rounded transition w-full">
               <Upload className="w-10 h-10 text-muted-foreground mb-2"/>
               <span className="font-semibold">Upload Model (.onnx)</span>
               <span className="text-xs text-muted-foreground">Required for inference</span>
               <input type="file" accept=".onnx" onChange={handleModelUpload} className="hidden" />
             </label>
          ) : (
            <div className="flex flex-col gap-2">
               <div className="flex items-center gap-3 bg-green-500/10 p-3 rounded border border-green-500/20">
                  <FileCode className="w-5 h-5 text-green-600"/>
                  <div className="text-left flex-1">
                    <div className="font-bold text-sm">Model Loaded</div>
                    <div className="text-xs opacity-70">
                        {isAutoConfigured ? "✨ Auto-Configured" : "⚠️ Manual Config"}
                    </div>
                  </div>
                  <button onClick={() => setSession(null)} className="text-xs text-destructive hover:underline">Unload</button>
               </div>
            </div>
          )}
        </div>

        {/* CONFIGURATION (Always Visible now for debugging) */}
        {session && (
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
             <div className="space-y-2">
                <div className="text-sm font-semibold flex items-center gap-2">
                  <Settings2 className="w-4 h-4" /> Configuration
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Window Size</label>
                      <input 
                        type="number" 
                        value={windowSize} 
                        onChange={(e) => setWindowSize(Number(e.target.value))}
                        className="w-full p-2 text-sm border rounded bg-background"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Input Mode</label>
                      <select 
                        value={inputMode}
                        onChange={(e) => setInputMode(e.target.value as any)}
                        className="w-full p-2 text-sm border rounded bg-background"
                      >
                        <option value="FLAT">Flat [1, N]</option>
                        <option value="CH_1">Channel [1, 1, N]</option>
                        <option value="CH_2">Dual [1, 2, N]</option>
                      </select>
                    </div>
                </div>
             </div>

             <div className="h-px bg-border my-2" />

             <div className="space-y-2">
               <label className="text-sm font-semibold">Test Data</label>
               <select 
                  className="w-full p-2 bg-background border rounded text-sm"
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  value={selectedSessionId}
               >
                  <option value="">-- Select Recording --</option>
                  {sessions.map(s => <option key={s.id} value={s.id}>{s.patientName} • {new Date(s.startTime).toLocaleDateString()}</option>)}
               </select>
             </div>

             <button 
                onClick={runInference}
                disabled={isRunning || !selectedSessionId}
                className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-bold shadow hover:opacity-90 disabled:opacity-50 flex justify-center gap-2 items-center"
             >
                {isRunning ? 'Processing...' : <><Play className="w-4 h-4"/> Run Analysis</>}
             </button>
             {isRunning && <div className="h-1 bg-muted w-full overflow-hidden rounded"><div className="h-full bg-primary transition-all duration-300" style={{width: `${progress}%`}}/></div>}
          </div>
        )}

        {/* RESULTS CARD */}
        {inferenceResult && (
           <div className="bg-card border border-border rounded-lg p-4 space-y-3 shadow-sm">
              <div className="flex justify-between items-center">
                  <h3 className="font-bold flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Report</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${inferenceResult.mae < 10 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    MAE: {inferenceResult.mae}
                  </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-accent/10 rounded border text-center">
                      <div className="text-xs text-muted-foreground uppercase mb-1">Prediction</div>
                      <div className="text-2xl font-bold text-primary">{inferenceResult.predictedSBP} / {inferenceResult.predictedDBP}</div>
                  </div>
                  <div className="p-3 bg-accent/10 rounded border text-center">
                      <div className="text-xs text-muted-foreground uppercase mb-1">Ground Truth</div>
                      <div className="text-2xl font-bold">{inferenceResult.actualSBP} / {inferenceResult.actualDBP}</div>
                  </div>
              </div>
           </div>
        )}

        {/* LOGS */}
        <div className="bg-black text-green-400 font-mono text-[10px] p-3 rounded h-24 overflow-y-auto border border-border opacity-80">
            {logs.length === 0 && <span className="text-gray-600">System Ready.</span>}
            {logs.map((l, i) => <div key={i}>{l}</div>)}
            <div ref={logsEndRef}/>
        </div>
      </div>
    </div>
  );
}