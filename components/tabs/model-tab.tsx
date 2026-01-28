'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Upload, Play, TrendingUp, Download, Activity, FileCode, PencilLine, RotateCcw } from 'lucide-react';
import { RecordingSession, SignalStorage, applyFilterToArray, estimateBloodPressure } from '@/lib/signal-processing';
import SignalVisualizer from '@/components/visualization/signal-visualizer';

// --- Global Type Definition for ONNX Runtime ---
declare global {
  interface Window {
    ort: any;
  }
}

// --- Types ---
interface ModelInfo {
  name: string;
  format: 'onnx' | 'tflite' | 'pth' | 'pkl' | 'unknown';
  size: number;
  uploadedAt: Date;
  fileData: ArrayBuffer;
}

interface InferenceResult {
  predictedSBP: number;
  predictedDBP: number;
  confidence: number;
  actualSBP?: number;
  actualDBP?: number;
  error?: {
    sbpError: number;
    dbpError: number;
    maeError: number;
  };
  inferenceTimeMs: number;
  executionBackend: string;
}

export default function ModelTab() {
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [isRunningInference, setIsRunningInference] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Ground Truth Overrides
  const [manualSBP, setManualSBP] = useState<number | ''>('');
  const [manualDBP, setManualDBP] = useState<number | ''>('');

  // Visualization
  const [processingSignal, setProcessingSignal] = useState<number[]>([]);

  useEffect(() => { loadSessions(); }, []);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const addLog = (msg: string) => setLogs(p => [...p, `[${new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}] ${msg}`]);

  const loadSessions = async () => {
    try {
      const storage = new SignalStorage();
      const data = await storage.getSessions();
      setSessions(data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    let format: ModelInfo['format'] = 'unknown';

    if (ext === 'onnx') format = 'onnx';
    else if (ext === 'tflite') format = 'tflite';
    else if (['pth', 'pt'].includes(ext || '')) format = 'pth';
    else if (ext === 'pkl') format = 'pkl';

    const buffer = await file.arrayBuffer();

    setModel({
      name: file.name,
      format,
      size: file.size,
      uploadedAt: new Date(),
      fileData: buffer
    });

    setInferenceResult(null);
    setLogs([]);
    addLog(`Model Loaded: ${file.name}`);
    addLog(`Format: ${format.toUpperCase()} | Size: ${(file.size / 1024).toFixed(1)} KB`);

    if (format === 'pth' || format === 'pkl') {
      addLog(`⚠️ NOTE: .${format} is a Python format.`);
      addLog(`   Browsers cannot run this natively. App will run in SIMULATION MODE.`);
    }
    if (format === 'tflite') {
        addLog(`⚠️ NOTE: Native TFLite disabled.`);
        addLog(`   Using Simulation Mode for .tflite files.`);
    }
  };

  // --- HELPER: Inject CDN Script ---
  const loadONNXRuntime = async () => {
    if (window.ort) return window.ort; // Already loaded

    return new Promise((resolve, reject) => {
      addLog("Downloading ONNX Runtime Engine (CDN)...");
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js";
      script.async = true;
      script.onload = () => {
        addLog("Engine Downloaded.");
        resolve(window.ort);
      };
      script.onerror = () => reject(new Error("Failed to load ONNX Runtime from CDN"));
      document.body.appendChild(script);
    });
  };

  // --- ENGINE 1: ONNX RUNTIME (CDN INJECTION) ---
  const runONNX = async (modelData: ArrayBuffer, signal: number[]) => {
    // 1. Ensure Library is Loaded
    const ort = await loadONNXRuntime();

    // 2. Configure Environment (Force Single-Thread + CDN WASM)
    // This prevents "Unknown CPU Vendor" and threading crashes
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
    ort.env.wasm.numThreads = 1; 
    ort.env.wasm.simd = false;   
    ort.env.wasm.proxy = false; 

    addLog(`Config: Single-Thread Mode. WASM source set.`);

    // 3. Create Session
    const session = await ort.InferenceSession.create(modelData, { 
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'basic',
        executionMode: 'sequential'
    });
    
    addLog(`Session Ready. Input: "${session.inputNames[0]}"`);

    // 4. Preprocess (120 Samples)
    const INPUT_LEN = 120;
    const float32Data = new Float32Array(INPUT_LEN);
    if (signal.length >= INPUT_LEN) {
        float32Data.set(signal.slice(0, INPUT_LEN));
    } else {
        float32Data.set(signal);
    }
    
    // 5. Create Tensor
    const tensor = new ort.Tensor('float32', float32Data, [1, 1, INPUT_LEN]);
    const start = performance.now();
    
    // 6. Run Inference
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const end = performance.now();

    // 7. Parse
    const outputName = session.outputNames[0];
    const outputData = results[outputName].data as Float32Array;
    
    return { sbp: outputData[0], dbp: outputData[1], time: end - start, backend: 'ONNX/WASM (CDN)' };
  };

  // --- ENGINE 2: SIMULATION / FALLBACK ---
  const runSimulation = async (signal: number[], format: string, samplingRate: number) => {
    addLog(`⚠️ BACKEND: Native execution for .${format} is unavailable.`);
    addLog("   Running heuristic fallback (Simulation Mode)...");
    
    await new Promise(r => setTimeout(r, 1200)); 
    
    const heuristic = estimateBloodPressure(signal, samplingRate);
    
    return { 
      sbp: heuristic.sbp, 
      dbp: heuristic.dbp, 
      time: 1200, 
      backend: `SIMULATION (${format})` 
    };
  };

  const handleRunInference = async () => {
    if (!model || !selectedSessionId) return;
    setIsRunningInference(true);
    setInferenceResult(null);
    setLogs([]); 
    addLog("=== Starting Inference Pipeline ===");

    try {
      const storage = new SignalStorage();
      let session = await storage.getSession(selectedSessionId);
      if (!session) session = sessions.find(s => s.id === selectedSessionId);
      if (!session) throw new Error("Session not found");

      // Ground Truth
      const useOverride = manualSBP !== '' && manualDBP !== '';
      const actualSBP = useOverride ? Number(manualSBP) : (session.sbp || 120);
      const actualDBP = useOverride ? Number(manualDBP) : (session.dbp || 80);

      addLog(`Patient: ${session.patientName || 'Unknown'} | GT: ${actualSBP}/${actualDBP}`);

      // Preprocessing
      const filtered = applyFilterToArray(session.rawSignal.map(s => s.value));
      setProcessingSignal(filtered);
      addLog("Signal Preprocessed (4Hz Butterworth LowPass)");

      // Routing
      let res;
      if (model.format === 'onnx') {
        res = await runONNX(model.fileData, filtered);
      } else {
        res = await runSimulation(filtered, model.format, session.samplingRate);
      }

      addLog(`Success! Backend: ${res.backend}`);
      addLog(`Output: [${res.sbp.toFixed(1)}, ${res.dbp.toFixed(1)}] mmHg`);

      // Metrics
      const sbpError = Math.abs(res.sbp - actualSBP);
      const dbpError = Math.abs(res.dbp - actualDBP);
      const mae = (sbpError + dbpError) / 2;

      // Noise Confidence
      const mean = filtered.reduce((a,b)=>a+b,0)/filtered.length;
      const std = Math.sqrt(filtered.reduce((a,b) => a + Math.pow(b - mean, 2), 0) / filtered.length);
      const conf = Math.max(0.5, Math.min(0.99, 1 - Math.abs(std - 0.15) * 2));

      setInferenceResult({
        predictedSBP: Math.round(res.sbp),
        predictedDBP: Math.round(res.dbp),
        confidence: Number(conf.toFixed(2)),
        actualSBP,
        actualDBP,
        error: {
          sbpError: Number(sbpError.toFixed(1)),
          dbpError: Number(dbpError.toFixed(1)),
          maeError: Number(mae.toFixed(1))
        },
        inferenceTimeMs: res.time,
        executionBackend: res.backend
      });

    } catch (e) {
      console.error(e);
      addLog(`CRITICAL ERROR: ${(e as Error).message}`);
    } finally {
      setIsRunningInference(false);
    }
  };

  const exportCSV = () => {
    if (!inferenceResult || !selectedSessionId) return;
    const csv = `Metric,Value\nBackend,${inferenceResult.executionBackend}\nPred SBP,${inferenceResult.predictedSBP}\nPred DBP,${inferenceResult.predictedDBP}\nMAE,${inferenceResult.error?.maeError}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `inference_${Date.now()}.csv`;
    a.click();
  };

  return (
    <div className="w-full flex flex-col bg-background min-h-screen">
      <div className="p-4 border-b border-border">
        <h1 className="text-2xl font-bold">Inference Engine</h1>
        <p className="text-sm text-muted-foreground">Run ONNX & ML models in-browser</p>
      </div>

      <div className="flex-1 overflow-auto pb-20 p-4 space-y-4">
        
        {/* Upload Card */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5" /> Load Model
          </h2>

          {!model ? (
            <label className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-accent/5 transition-colors">
              <input type="file" onChange={handleModelUpload} accept=".onnx,.tflite,.pth,.pkl" className="hidden" />
              <FileCode className="w-10 h-10 text-muted-foreground mb-2" />
              <p className="font-medium">Click to Upload Model</p>
              <p className="text-xs text-muted-foreground mt-1">Recommended: .ONNX</p>
            </label>
          ) : (
            <div className="bg-muted/20 border border-border rounded p-3 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded ${model.format === 'onnx' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300'}`}>
                  <Activity className="w-5 h-5"/>
                </div>
                <div>
                  <div className="font-bold text-sm">{model.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    {model.format.toUpperCase()} • {(model.size/1024).toFixed(0)}KB
                    {model.format !== 'onnx' && <span className="text-orange-600 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/50 px-1 rounded text-[10px]">SIMULATION</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => setModel(null)} className="text-xs text-destructive hover:underline">Remove</button>
            </div>
          )}
        </div>

        {/* Session Select */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="font-semibold mb-3">Test Data</h2>
          <select 
            className="w-full p-2 bg-background border border-border rounded mb-3 text-sm"
            onChange={(e) => setSelectedSessionId(e.target.value)}
            value={selectedSessionId}
          >
            <option value="">-- Select Recorded Session --</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.patientName || 'Unknown'} - {new Date(s.startTime).toLocaleDateString()}</option>
            ))}
          </select>

          {/* Overrides */}
          {selectedSessionId && (
            <div className="flex gap-2 items-center bg-muted/30 p-2 rounded border border-border/50">
              <PencilLine className="w-4 h-4 text-muted-foreground"/>
              <input type="number" placeholder="Ref SBP" value={manualSBP} onChange={e=>setManualSBP(Number(e.target.value))} className="w-20 p-1 text-sm bg-background border rounded"/>
              <span className="text-muted-foreground">/</span>
              <input type="number" placeholder="Ref DBP" value={manualDBP} onChange={e=>setManualDBP(Number(e.target.value))} className="w-20 p-1 text-sm bg-background border rounded"/>
              <span className="text-xs text-muted-foreground ml-auto">mmHg</span>
              {(manualSBP || manualDBP) && <button onClick={()=>{setManualSBP('');setManualDBP('')}}><RotateCcw className="w-3 h-3 text-primary"/></button>}
            </div>
          )}
        </div>

        {/* Action & Vis */}
        {model && selectedSessionId && (
          <button 
            onClick={handleRunInference}
            disabled={isRunningInference}
            className="w-full bg-primary text-primary-foreground p-4 rounded-xl font-bold flex justify-center items-center gap-2 shadow-lg hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {isRunningInference ? <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full"/> : <Play className="w-5 h-5 fill-current"/>}
            Run Inference
          </button>
        )}

        {processingSignal.length > 0 && (
          <SignalVisualizer rawSignal={[]} filteredSignal={processingSignal} title="Input Tensor Visualization" color="emerald" height={80} />
        )}

        {/* Results */}
        {inferenceResult && (
          <div className="bg-card border border-border rounded-lg p-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-500"/> Results
                </h3>
                <span className="text-[10px] bg-muted px-1 rounded text-muted-foreground">Backend: {inferenceResult.executionBackend}</span>
              </div>
              <div className={`text-xl font-mono font-bold ${inferenceResult.error && inferenceResult.error.maeError < 8 ? 'text-green-500' : 'text-amber-500'}`}>
                MAE: {inferenceResult.error?.maeError}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-background p-3 rounded border text-center">
                <div className="text-xs text-muted-foreground uppercase">Predicted</div>
                <div className="text-2xl font-bold text-primary">{inferenceResult.predictedSBP}/{inferenceResult.predictedDBP}</div>
              </div>
              <div className="bg-background p-3 rounded border text-center">
                <div className="text-xs text-muted-foreground uppercase">Reference</div>
                <div className="text-2xl font-bold text-muted-foreground">{inferenceResult.actualSBP}/{inferenceResult.actualDBP}</div>
              </div>
            </div>

            <button onClick={exportCSV} className="w-full py-2 border border-border rounded flex justify-center items-center gap-2 hover:bg-accent/5">
              <Download className="w-4 h-4"/> Export CSV
            </button>
          </div>
        )}

        {/* Console */}
        <div className="bg-black/90 text-green-400 font-mono text-[10px] p-3 rounded h-40 overflow-y-auto">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
          <div ref={logsEndRef}/>
        </div>
      </div>
    </div>
  );
}