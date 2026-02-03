'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Upload, TrendingUp, Download, Activity, FileCode, Layers, Play, AlertCircle, RotateCcw, PencilLine } from 'lucide-react';
import { RecordingSession, SignalStorage, applyFilterToArray } from '@/lib/signal-processing';
import * as ort from 'onnxruntime-web';

ort.env.wasm.wasmPaths = "/"; 

interface ModelInfo {
  name: string;
  size: number;
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
  backend: string;
  windowsProcessed: number;
}

export default function ModelTab() {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [session, setSession] = useState<ort.InferenceSession | null>(null);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [isRunningInference, setIsRunningInference] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0); 
  
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

    if (!file.name.endsWith('.onnx')) {
      alert("Please upload a .onnx file");
      return;
    }

    setLogs([]);
    addLog(`Loading ${file.name}...`);
    setIsRunningInference(true);

    try {
      const buffer = await file.arrayBuffer();
      const s = await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      setSession(s);
      setModelInfo({ name: file.name, size: file.size });
      addLog(`Model Loaded. Inputs: [${s.inputNames.join(', ')}]`);
    } catch (err) {
      addLog(`Error: ${(err as Error).message}`);
    } finally {
      setIsRunningInference(false);
    }
  };

  const createTensor = (
    data: Float32Array, 
    targetSize: number, 
    mode: 'FLAT' | 'CH_1' | 'CH_2'
  ): { tensor: ort.Tensor } => {
    
    // Force deep copy
    const freshData = new Float32Array(data.slice(0, targetSize));
    
    if (mode === 'FLAT') {
      return { tensor: new ort.Tensor('float32', freshData, [1, targetSize]) };
    } 
    else if (mode === 'CH_1') {
      return { tensor: new ort.Tensor('float32', freshData, [1, 1, targetSize]) };
    } 
    else {
      const dualChannel = new Float32Array(targetSize * 2);
      dualChannel.set(freshData);           
      dualChannel.set(freshData, targetSize); 
      return { tensor: new ort.Tensor('float32', dualChannel, [1, 2, targetSize]) };
    }
  };

  const runInferencePipeline = async () => {
    if (!session || !selectedSessionId) return;
    
    setIsRunningInference(true);
    setInferenceResult(null);
    setProgress(0);
    setLogs([]); 
    addLog("Initializing Dynamic Inference Engine...");

    try {
      const storage = new SignalStorage();
      let record = await storage.getSession(selectedSessionId);
      if (!record) record = sessions.find(s => s.id === selectedSessionId);
      if (!record) throw new Error("Session not found");

      const rawSignal = applyFilterToArray(record.rawSignal.map(s => s.value));
      const fullSignal = new Float32Array(rawSignal);

      const actualSBP = manualSBP !== '' ? Number(manualSBP) : (record.sbp || 120);
      const actualDBP = manualDBP !== '' ? Number(manualDBP) : (record.dbp || 80);

      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];

      // --- STAGE 1: SHAPE PROBING ---
      let bestSize = 1250; 
      let bestMode: 'FLAT' | 'CH_1' | 'CH_2' = 'FLAT';
      let shapeFound = false;
      const modes: ('FLAT' | 'CH_1' | 'CH_2')[] = ['FLAT', 'CH_1', 'CH_2'];

      // Ensure we have at least enough data for the initial probe size
      if (fullSignal.length < 24) throw new Error("Signal too short for any model.");

      for (const mode of modes) {
        if (shapeFound) break;
        
        try {
            // Safety: Don't probe if signal < bestSize (unless we suspect small model)
            const probeSize = (fullSignal.length < bestSize) ? 24 : bestSize;
            
            const { tensor } = createTensor(fullSignal, probeSize, mode);
            await session.run({ [inputName]: tensor });
            
            bestMode = mode;
            bestSize = probeSize; // If 24 worked, keep it
            shapeFound = true;
            addLog(`Configuration Found: ${mode} [1, ..., ${bestSize}]`);
        } catch (e) {
            const errMsg = (e as Error).message;
            const sizeMatch = errMsg.match(/expected.*?(\d{2,4})/i) || errMsg.match(/size.*?(\d{2,4})/i);
            
            if (sizeMatch && sizeMatch[1]) {
                const detectedSize = parseInt(sizeMatch[1]);
                if (detectedSize > 0 && detectedSize !== bestSize) {
                    addLog(`Model requires size ${detectedSize}. Adapting...`);
                    bestSize = detectedSize;
                    
                    try {
                        const retry = createTensor(fullSignal, bestSize, mode);
                        await session.run({ [inputName]: retry.tensor });
                        bestMode = mode;
                        shapeFound = true;
                        addLog(`Adaptation Successful. Locked Size: ${bestSize}`);
                        break; 
                    } catch (retryErr) {}
                }
            }
        }
      }

      if (!shapeFound) throw new Error("Could not detect model shape compatibility.");

      // --- STAGE 2: PROCESSING LOOP (FIXED) ---
      
      // 1. Check if we have enough data for AT LEAST one window
      if (fullSignal.length < bestSize) {
        throw new Error(`Signal length (${fullSignal.length}) < Required Window (${bestSize}). Recording is too short.`);
      }

      const STRIDE = Math.max(1, Math.floor(bestSize / 4)); 
      
      // FIX: Use simple loop condition instead of pre-calculating steps
      // If length=1350 and size=1250, loop runs once (i=0).
      const predictions: {sbp: number, dbp: number}[] = [];
      const startTime = performance.now();

      // Estimate windows for progress bar only
      const estimatedWindows = Math.ceil((fullSignal.length - bestSize) / STRIDE) || 1;
      addLog(`Processing approx ${estimatedWindows} windows...`);

      for (let i = 0; i <= fullSignal.length - bestSize; i += STRIDE) {
        // UI Updates
        if (i % (STRIDE * 5) === 0 || i === 0) {
          const percent = Math.round((i / (fullSignal.length - bestSize)) * 100);
          setProgress(percent);
          await new Promise(r => setTimeout(r, 0));
        }

        const windowSlice = fullSignal.slice(i, i + bestSize);
        const { tensor } = createTensor(windowSlice, bestSize, bestMode);
        
        const results = await session.run({ [inputName]: tensor });
        const output = results[outputName].data as Float32Array;

        const s = output[0] || 120;
        const d = output[1] || (output.length > 2 ? output[2] : 80); 
        predictions.push({ sbp: s, dbp: d });
      }

      const endTime = performance.now();

      // --- STAGE 3: RESULTS ---
      if (predictions.length === 0) throw new Error("No predictions generated.");

      const avgSBP = predictions.reduce((a, b) => a + b.sbp, 0) / predictions.length;
      const avgDBP = predictions.reduce((a, b) => a + b.dbp, 0) / predictions.length;
      
      const errorSBP = Math.abs(avgSBP - actualSBP);
      const errorDBP = Math.abs(avgDBP - actualDBP);
      const mae = (errorSBP + errorDBP) / 2;

      setInferenceResult({
        predictedSBP: Math.round(avgSBP),
        predictedDBP: Math.round(avgDBP),
        confidence: 1.0, 
        actualSBP,
        actualDBP,
        error: { sbpError: errorSBP, dbpError: errorDBP, maeError: Number(mae.toFixed(2)) },
        inferenceTimeMs: endTime - startTime,
        backend: `ONNX (${bestMode} / ${bestSize})`,
        windowsProcessed: predictions.length
      });

      addLog(`Success. MAE: ${mae.toFixed(2)}`);

    } catch (e) {
      addLog(`FATAL: ${(e as Error).message}`);
      console.error(e);
    } finally {
      setIsRunningInference(false);
      setProgress(100);
    }
  };

  return (
    <div className="w-full flex flex-col bg-background h-screen max-h-[80vh]">
      <div className="p-4 border-b border-border space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="w-6 h-6"/> Auto-Adaptive Inference
        </h1>
        <p className="text-xs text-muted-foreground">
          Universal ONNX Loader • Auto-Shape Detection • Fresh Buffer Pipeline
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        
        {/* Loader */}
        <div className="bg-card border border-border rounded-lg p-6 flex flex-col items-center justify-center border-dashed">
          {!session ? (
             <label className="cursor-pointer flex flex-col items-center hover:bg-accent/5 p-4 rounded transition-colors w-full">
               <Upload className="w-10 h-10 text-muted-foreground mb-2"/>
               <span className="font-semibold">Upload Model (.onnx)</span>
               <input type="file" accept=".onnx" onChange={handleModelUpload} className="hidden" />
             </label>
          ) : (
            <div className="flex items-center gap-4 w-full bg-muted/20 p-3 rounded">
               <div className="bg-green-100 dark:bg-green-900 p-2 rounded text-green-700 dark:text-green-300">
                  <FileCode className="w-6 h-6"/>
               </div>
               <div className="flex-1">
                 <div className="font-bold">{modelInfo?.name}</div>
                 <div className="text-xs text-muted-foreground">{(modelInfo!.size / 1024).toFixed(0)} KB • Ready</div>
               </div>
               <button onClick={() => setSession(null)} className="text-destructive text-xs hover:underline">Unload</button>
            </div>
          )}
        </div>

        {/* Data Selector */}
        {session && (
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
             <div className="text-sm font-semibold">Select Input Data</div>
             <select 
                className="w-full p-2 bg-background border rounded text-sm"
                onChange={(e) => setSelectedSessionId(e.target.value)}
                value={selectedSessionId}
             >
                <option value="">-- Select Recording --</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.patientName} ({new Date(s.startTime).toLocaleDateString()})</option>)}
             </select>
             
             {selectedSessionId && (
                <div className="flex gap-2 text-sm items-center bg-muted/10 p-2 rounded">
                    <span className="text-muted-foreground text-xs uppercase font-bold">Override GT:</span>
                    <input type="number" placeholder="SBP" value={manualSBP} onChange={e=>setManualSBP(Number(e.target.value))} className="w-16 p-1 border rounded bg-background text-center"/>
                    <input type="number" placeholder="DBP" value={manualDBP} onChange={e=>setManualDBP(Number(e.target.value))} className="w-16 p-1 border rounded bg-background text-center"/>
                    {(manualSBP || manualDBP) && <button onClick={()=>{setManualSBP('');setManualDBP('')}}><RotateCcw className="w-3 h-3"/></button>}
                </div>
             )}

             <button 
                onClick={runInferencePipeline}
                disabled={isRunningInference}
                className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-bold shadow hover:opacity-90 disabled:opacity-50 flex justify-center gap-2 items-center"
             >
                {isRunningInference ? 'Processing...' : <><Play className="w-4 h-4"/> Run Inference</>}
             </button>
             {isRunningInference && <div className="h-1 bg-muted w-full overflow-hidden rounded"><div className="h-full bg-primary transition-all duration-300" style={{width: `${progress}%`}}/></div>}
          </div>
        )}

        {/* Results */}
        {inferenceResult && (
           <div className="bg-card border border-border rounded-lg p-4 animate-in slide-in-from-bottom-2">
              <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Results</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${inferenceResult.error!.maeError < 10 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    MAE: {inferenceResult.error!.maeError}
                  </span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="p-2 bg-background border rounded">
                      <div className="text-xs text-muted-foreground uppercase">Predicted</div>
                      <div className="text-xl font-bold text-primary">{inferenceResult.predictedSBP} / {inferenceResult.predictedDBP}</div>
                  </div>
                  <div className="p-2 bg-background border rounded">
                      <div className="text-xs text-muted-foreground uppercase">Actual</div>
                      <div className="text-xl font-bold">{inferenceResult.actualSBP} / {inferenceResult.actualDBP}</div>
                  </div>
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground text-center">
                  Backend: {inferenceResult.backend} • Windows: {inferenceResult.windowsProcessed}
              </div>
           </div>
        )}

        {/* Console */}
        <div className="bg-black text-green-400 font-mono text-[10px] p-3 rounded h-32 overflow-y-auto border border-border shadow-inner">
            {logs.length === 0 && <span className="text-gray-600">Waiting for model...</span>}
            {logs.map((l, i) => <div key={i}>{l}</div>)}
            <div ref={logsEndRef}/>
        </div>

      </div>
    </div>
  );
}