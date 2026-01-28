'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Upload, Play, TrendingUp, Download, Activity, FileCode, PencilLine, RotateCcw, Layers } from 'lucide-react';
import { RecordingSession, SignalStorage, applyFilterToArray } from '@/lib/signal-processing';
import SignalVisualizer from '@/components/visualization/signal-visualizer';
import * as ort from 'onnxruntime-web';

// Configure ONNX Runtime to look for WASM files in the public directory
ort.env.wasm.wasmPaths = "/"; 

interface ModelInfo {
  name: string;
  size: number;
  uploadedAt: Date;
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
  windowsProcessed: number; // New metric to show how many segments we averaged
}

export default function ModelTab() {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [session, setSession] = useState<ort.InferenceSession | null>(null);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [isRunningInference, setIsRunningInference] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0); // Progress bar for sliding window
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
      addLog("Error loading recording sessions.");
    }
  };

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    
    if (ext !== 'onnx') {
      alert("Invalid format. Only .ONNX models are supported.");
      return;
    }

    setLogs([]);
    addLog(`Loading Model: ${file.name}...`);
    setIsRunningInference(true);

    try {
      const buffer = await file.arrayBuffer();
      const newSession = await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      setSession(newSession);
      setModelInfo({
        name: file.name,
        size: file.size,
        uploadedAt: new Date(),
      });

      addLog(`Model Loaded Successfully.`);
      addLog(`Input Nodes: ${newSession.inputNames.join(', ')}`);
      
    } catch (err) {
      console.error(err);
      addLog(`CRITICAL ERROR: Failed to load model.`);
      addLog(`${(err as Error).message}`);
      setSession(null);
      setModelInfo(null);
    } finally {
      setIsRunningInference(false);
    }
  };

  const runInferencePipeline = async () => {
    if (!session || !selectedSessionId) return;
    setIsRunningInference(true);
    setInferenceResult(null);
    setProgress(0);
    addLog("=== Starting Sliding Window Inference ===");

    try {
      const storage = new SignalStorage();
      let record = await storage.getSession(selectedSessionId);
      if (!record) record = sessions.find(s => s.id === selectedSessionId);
      if (!record) throw new Error("Session data not found");

      // 1. Ground Truth Setup
      const useOverride = manualSBP !== '' && manualDBP !== '';
      const actualSBP = useOverride ? Number(manualSBP) : (record.sbp || 120);
      const actualDBP = useOverride ? Number(manualDBP) : (record.dbp || 80);

      addLog(`Patient: ${record.patientName || 'Unknown'} | GT: ${actualSBP}/${actualDBP}`);

      // 2. Preprocessing
      const fullSignal = applyFilterToArray(record.rawSignal.map(s => s.value));
      addLog(`Signal Length: ${fullSignal.length} samples (${(fullSignal.length/30).toFixed(1)}s)`);

      // 3. Sliding Window Setup
      const WINDOW_SIZE = 120; // Model Requirement (4 seconds)
      const STRIDE = 30;       // Step size (1 second) -> Overlapping windows
      
      if (fullSignal.length < WINDOW_SIZE) {
        throw new Error(`Signal too short. Need ${WINDOW_SIZE} samples, got ${fullSignal.length}`);
      }

      const predictions: {sbp: number, dbp: number}[] = [];
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      
      const startTime = performance.now();
      
      // 4. Run Loop
      const totalWindows = Math.floor((fullSignal.length - WINDOW_SIZE) / STRIDE) + 1;
      addLog(`Processing ${totalWindows} windows...`);

      for (let i = 0; i <= fullSignal.length - WINDOW_SIZE; i += STRIDE) {
        // Update progress UI every few frames
        if (i % (STRIDE * 5) === 0) {
          setProgress(Math.round((i / fullSignal.length) * 100));
          await new Promise(r => setTimeout(r, 0)); // Yield to UI
        }

        // Slice Window
        const windowData = new Float32Array(fullSignal.slice(i, i + WINDOW_SIZE));
        
        // Create Tensor [1, 1, 120]
        const tensor = new ort.Tensor('float32', windowData, [1, 1, WINDOW_SIZE]);
        
        // Run Inference
        const results = await session.run({ [inputName]: tensor });
        const output = results[outputName].data as Float32Array;
        
        predictions.push({ sbp: output[0], dbp: output[1] });
      }

      const endTime = performance.now();
      
      // 5. Aggregate Results (Average)
      // Filter outliers (optional: simple mean for now)
      const avgSBP = predictions.reduce((a, b) => a + b.sbp, 0) / predictions.length;
      const avgDBP = predictions.reduce((a, b) => a + b.dbp, 0) / predictions.length;

      addLog(`Processed ${predictions.length} windows in ${(endTime - startTime).toFixed(0)}ms`);
      addLog(`Average Output: [${avgSBP.toFixed(1)}, ${avgDBP.toFixed(1)}]`);

      // Visualization: Show the first window just for reference
      setProcessingSignal(fullSignal.slice(0, WINDOW_SIZE));

      // 6. Metrics
      const sbpError = Math.abs(avgSBP - actualSBP);
      const dbpError = Math.abs(avgDBP - actualDBP);
      const mae = (sbpError + dbpError) / 2;

      // Confidence based on stability (Standard Deviation of predictions)
      const sbpVariance = predictions.reduce((a, b) => a + Math.pow(b.sbp - avgSBP, 2), 0) / predictions.length;
      const stability = Math.max(0, 1 - Math.sqrt(sbpVariance) / 20); // Heuristic

      setInferenceResult({
        predictedSBP: Math.round(avgSBP),
        predictedDBP: Math.round(avgDBP),
        confidence: Number(stability.toFixed(2)),
        actualSBP,
        actualDBP,
        error: {
          sbpError: Number(sbpError.toFixed(1)),
          dbpError: Number(dbpError.toFixed(1)),
          maeError: Number(mae.toFixed(1))
        },
        inferenceTimeMs: endTime - startTime,
        executionBackend: 'ONNX/WASM (Sliding Window)',
        windowsProcessed: predictions.length
      });

    } catch (e) {
      console.error(e);
      addLog(`ERROR: ${(e as Error).message}`);
    } finally {
      setIsRunningInference(false);
      setProgress(100);
    }
  };

  const exportCSV = () => {
    if (!inferenceResult || !selectedSessionId) return;
    const csv = `Metric,Value\nBackend,${inferenceResult.executionBackend}\nWindows,${inferenceResult.windowsProcessed}\nPred SBP,${inferenceResult.predictedSBP}\nPred DBP,${inferenceResult.predictedDBP}\nMAE,${inferenceResult.error?.maeError}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `inference_avg_${Date.now()}.csv`;
    a.click();
  };

  return (
    <div className="w-full flex flex-col bg-background min-h-screen">
      <div className="p-4 border-b border-border">
        <h1 className="text-2xl font-bold">Inference Engine</h1>
        <p className="text-sm text-muted-foreground">Run ONNX models locally in-browser</p>
      </div>

      <div className="flex-1 overflow-auto pb-20 p-4 space-y-4">
        
        {/* Upload Card */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5" /> Load Model
          </h2>

          {!session ? (
            <label className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-accent/5 transition-colors">
              <input type="file" onChange={handleModelUpload} accept=".onnx" className="hidden" />
              <FileCode className="w-10 h-10 text-muted-foreground mb-2" />
              <p className="font-medium">Click to Upload .ONNX Model</p>
              <p className="text-xs text-muted-foreground mt-1">Other formats (.tflite, .pth) not supported</p>
            </label>
          ) : (
            <div className="bg-muted/20 border border-border rounded p-3 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                  <Activity className="w-5 h-5"/>
                </div>
                <div>
                  <div className="font-bold text-sm">{modelInfo?.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    ONNX Runtime Ready • {modelInfo ? (modelInfo.size/1024).toFixed(0) : 0}KB
                  </div>
                </div>
              </div>
              <button onClick={() => { setSession(null); setModelInfo(null); }} className="text-xs text-destructive hover:underline">Remove</button>
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
        {session && selectedSessionId && (
          <div className="space-y-2">
             <button 
                onClick={runInferencePipeline}
                disabled={isRunningInference}
                className="w-full bg-primary text-primary-foreground p-4 rounded-xl font-bold flex justify-center items-center gap-2 shadow-lg hover:opacity-90 disabled:opacity-50 transition-all"
            >
                {isRunningInference ? (
                    <div className="flex items-center gap-2">
                         <div className="animate-spin w-4 h-4 border-2 border-white/50 border-t-white rounded-full"/>
                         <span>Processing ({progress}%)</span>
                    </div>
                ) : (
                    <>
                        <Layers className="w-5 h-5"/> Run Sliding Window Inference
                    </>
                )}
            </button>
            {isRunningInference && <div className="h-1 w-full bg-muted overflow-hidden rounded"><div className="h-full bg-primary transition-all duration-300" style={{width: `${progress}%`}}/></div>}
          </div>
        )}

        {/* Results */}
        {inferenceResult && (
          <div className="bg-card border border-border rounded-lg p-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-500"/> Results (Averaged)
                </h3>
                <span className="text-[10px] bg-muted px-1 rounded text-muted-foreground">
                    Processed {inferenceResult.windowsProcessed} Windows ({inferenceResult.executionBackend})
                </span>
              </div>
              <div className={`text-xl font-mono font-bold ${inferenceResult.error && inferenceResult.error.maeError < 8 ? 'text-green-500' : 'text-amber-500'}`}>
                MAE: {inferenceResult.error?.maeError}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-background p-3 rounded border text-center">
                <div className="text-xs text-muted-foreground uppercase">Predicted (Avg)</div>
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