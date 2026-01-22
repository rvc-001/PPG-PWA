'use client';

import React from "react"

import { useEffect, useState } from 'react';
import { Upload, Play, AlertCircle, TrendingUp, Download } from 'lucide-react';
import { RecordingSession, SignalStorage } from '@/lib/signal-processing';
import SignalVisualizer from '@/components/visualization/signal-visualizer';

interface ModelInfo {
  name: string;
  format: string;
  uploadedAt: Date;
  expectedInputShape?: string;
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
}

export default function ModelTab() {
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [isRunningInference, setIsRunningInference] = useState(false);
  const [assumptions, setAssumptions] = useState({
    usesFiltered: true,
    samplingRate: 30,
    windowLength: 60,
  });

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const storage = new SignalStorage();
      const data = await storage.getSessions();
      setSessions(data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const handleModelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const format = file.name.split('.').pop()?.toLowerCase() || 'unknown';
    if (!['pth', 'pkl', 'onnx', 'pb', 'h5', 'tflite'].includes(format)) {
      alert('Unsupported model format. Supported formats: .pth, .pkl, .onnx, .pb, .h5, .tflite');
      return;
    }

    setModel({
      name: file.name,
      format: format,
      uploadedAt: new Date(),
      expectedInputShape: format === 'pth' ? '[batch, channels, samples]' : 'Variable',
    });
  };

  const handleRunInference = async () => {
    if (!model || !selectedSessionId) {
      alert('Please upload a model and select a session');
      return;
    }

    setIsRunningInference(true);

    try {
      // Simulate model inference
      // In production, this would load and run the actual model using TensorFlow.js, ONNX.js, or similar
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Get session data
      const storage = new SignalStorage();
      const session = await storage.getSession(selectedSessionId);
      if (!session) throw new Error('Session not found');

      // Simulate prediction
      // In reality, you would feed the filtered signal to the model
      const predictedSBP = 120 + Math.random() * 20 - 10;
      const predictedDBP = 80 + Math.random() * 10 - 5;

      // Simulated reference values (in production, these would come from user input or dataset)
      const actualSBP = 118;
      const actualDBP = 78;

      const sbpError = Math.abs(predictedSBP - actualSBP);
      const dbpError = Math.abs(predictedDBP - actualDBP);
      const maeError = (sbpError + dbpError) / 2;

      setInferenceResult({
        predictedSBP: Math.round(predictedSBP),
        predictedDBP: Math.round(predictedDBP),
        confidence: 0.92,
        actualSBP,
        actualDBP,
        error: {
          sbpError: Math.round(sbpError * 10) / 10,
          dbpError: Math.round(dbpError * 10) / 10,
          maeError: Math.round(maeError * 10) / 10,
        },
      });
    } catch (error) {
      console.error('Inference error:', error);
      alert('Error running inference: ' + (error as Error).message);
    } finally {
      setIsRunningInference(false);
    }
  };

  const handleExportResults = () => {
    if (!inferenceResult || !selectedSessionId) return;

    const session = sessions.find((s) => s.id === selectedSessionId);
    const csv = `Inference Results\nModel: ${model?.name}\nSession ID: ${selectedSessionId}\n\nMetric,Value\nPredicted SBP,${inferenceResult.predictedSBP}\nPredicted DBP,${inferenceResult.predictedDBP}\nConfidence,${(inferenceResult.confidence * 100).toFixed(1)}%\n${inferenceResult.actualSBP ? `Actual SBP,${inferenceResult.actualSBP}` : ''}\n${inferenceResult.actualDBP ? `Actual DBP,${inferenceResult.actualDBP}` : ''}\n${inferenceResult.error ? `SBP Error,${inferenceResult.error.sbpError}` : ''}\n${inferenceResult.error ? `DBP Error,${inferenceResult.error.dbpError}` : ''}\n${inferenceResult.error ? `MAE,${inferenceResult.error.maeError}` : ''}`;

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inference_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full flex flex-col bg-background min-h-screen">
      <div className="p-4 border-b border-border">
        <h1 className="text-2xl font-bold">ML Model Inference</h1>
        <p className="text-sm text-muted-foreground mt-1">Upload and evaluate models against physiological signals</p>
      </div>

      <div className="flex-1 overflow-auto pb-20">
        <div className="p-4 space-y-4">
          {/* Model Upload Section */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Model Upload
            </h2>

            {!model ? (
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    onChange={handleModelUpload}
                    accept=".pth,.pkl,.onnx,.pb,.h5,.tflite"
                    className="hidden"
                  />
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                    <p className="font-medium">Click to upload model</p>
                    <p className="text-xs text-muted-foreground">
                      Supported: .pth, .pkl, .onnx, .pb, .h5, .tflite
                    </p>
                  </div>
                </label>
              </div>
            ) : (
              <div className="bg-background rounded p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm">{model.name}</p>
                    <p className="text-xs text-muted-foreground">Format: {model.format.toUpperCase()}</p>
                  </div>
                  <button
                    onClick={() => setModel(null)}
                    className="text-destructive hover:text-destructive/80 text-sm font-medium"
                  >
                    Remove
                  </button>
                </div>
                {model.expectedInputShape && (
                  <p className="text-xs text-muted-foreground">Expected Input: {model.expectedInputShape}</p>
                )}
              </div>
            )}
          </div>

          {/* Model Assumptions */}
          {model && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-warning" />
                Model Assumptions
              </h2>

              <div className="space-y-3 p-3 bg-warning/10 rounded-lg border border-warning/30 mb-4">
                <p className="text-sm font-medium text-foreground">This model expects:</p>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>Filtered signal only (bandpass {assumptions.samplingRate} Hz assumed)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>MIMIC-III aligned sampling rate ({assumptions.samplingRate} Hz)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>Output: Systolic (SBP) and Diastolic (DBP) blood pressure estimates</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>Input window length: {assumptions.windowLength} seconds</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium block mb-2">Sampling Rate (Hz)</label>
                  <select
                    value={assumptions.samplingRate}
                    onChange={(e) => setAssumptions({ ...assumptions, samplingRate: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value={30}>30 Hz</option>
                    <option value={60}>60 Hz</option>
                    <option value={100}>100 Hz</option>
                    <option value={125}>125 Hz</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-2">Window Length (seconds)</label>
                  <input
                    type="number"
                    min="10"
                    max="300"
                    value={assumptions.windowLength}
                    onChange={(e) => setAssumptions({ ...assumptions, windowLength: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assumptions.usesFiltered}
                    onChange={(e) => setAssumptions({ ...assumptions, usesFiltered: e.target.checked })}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm">Uses filtered signal</span>
                </label>
              </div>

              <p className="text-xs text-muted-foreground mt-3 italic">
                ✓ Confirm these assumptions before running inference
              </p>
            </div>
          )}

          {/* Session Selection */}
          {model && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="font-semibold mb-4">Select Signal Data</h2>

              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No recorded sessions available. Record a session first.
                </p>
              ) : (
                <select
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select a session...</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.patientName || session.patientId || 'Unknown'} - {new Date(session.startTime).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Inference Controls */}
          {model && selectedSessionId && !inferenceResult && (
            <button
              onClick={handleRunInference}
              disabled={isRunningInference}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Play className="w-5 h-5" />
              {isRunningInference ? 'Running Inference...' : 'Run Inference'}
            </button>
          )}

          {/* Inference Results */}
          {inferenceResult && (
            <div className="space-y-4">
              {/* Predictions */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-accent" />
                  Predictions
                </h2>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-background rounded-lg p-4 border border-primary/30">
                    <p className="text-xs text-muted-foreground mb-1">Systolic (SBP)</p>
                    <p className="text-3xl font-bold text-primary">{inferenceResult.predictedSBP}</p>
                    <p className="text-xs text-muted-foreground mt-1">mmHg</p>
                  </div>
                  <div className="bg-background rounded-lg p-4 border border-secondary/30">
                    <p className="text-xs text-muted-foreground mb-1">Diastolic (DBP)</p>
                    <p className="text-3xl font-bold text-secondary">{inferenceResult.predictedDBP}</p>
                    <p className="text-xs text-muted-foreground mt-1">mmHg</p>
                  </div>
                </div>

                <div className="p-3 bg-accent/10 rounded border border-accent/30">
                  <p className="text-sm font-medium">Model Confidence</p>
                  <div className="w-full bg-background rounded-full h-2 mt-2 overflow-hidden">
                    <div
                      className="bg-accent h-full transition-all"
                      style={{ width: `${inferenceResult.confidence * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{(inferenceResult.confidence * 100).toFixed(1)}%</p>
                </div>
              </div>

              {/* Comparison with Actual */}
              {inferenceResult.actualSBP && inferenceResult.actualDBP && inferenceResult.error && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <h2 className="font-semibold mb-4">Comparison with Reference</h2>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-background rounded">
                      <div>
                        <p className="text-sm font-medium">Systolic (SBP)</p>
                        <p className="text-xs text-muted-foreground">
                          {inferenceResult.predictedSBP} vs {inferenceResult.actualSBP} (Δ {inferenceResult.error.sbpError})
                        </p>
                      </div>
                      <div
                        className={`text-xs font-bold px-2 py-1 rounded ${
                          inferenceResult.error.sbpError < 5
                            ? 'bg-accent/10 text-accent'
                            : inferenceResult.error.sbpError < 10
                              ? 'bg-warning/10 text-warning'
                              : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        {inferenceResult.error.sbpError < 5 ? 'Excellent' : inferenceResult.error.sbpError < 10 ? 'Good' : 'Fair'}
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-background rounded">
                      <div>
                        <p className="text-sm font-medium">Diastolic (DBP)</p>
                        <p className="text-xs text-muted-foreground">
                          {inferenceResult.predictedDBP} vs {inferenceResult.actualDBP} (Δ {inferenceResult.error.dbpError})
                        </p>
                      </div>
                      <div
                        className={`text-xs font-bold px-2 py-1 rounded ${
                          inferenceResult.error.dbpError < 5
                            ? 'bg-accent/10 text-accent'
                            : inferenceResult.error.dbpError < 10
                              ? 'bg-warning/10 text-warning'
                              : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        {inferenceResult.error.dbpError < 5 ? 'Excellent' : inferenceResult.error.dbpError < 10 ? 'Good' : 'Fair'}
                      </div>
                    </div>

                    <div className="p-3 bg-background rounded border border-border">
                      <p className="text-sm font-medium">Mean Absolute Error (MAE)</p>
                      <p className="text-xl font-bold text-foreground mt-1">{inferenceResult.error.maeError} mmHg</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Export Results */}
              <button
                onClick={handleExportResults}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-background border border-border text-foreground rounded-lg font-semibold hover:bg-background/80 transition-colors"
              >
                <Download className="w-5 h-5" />
                Export Results
              </button>

              {/* Start New Inference */}
              <button
                onClick={() => {
                  setInferenceResult(null);
                  setSelectedSessionId('');
                }}
                className="w-full px-4 py-2 text-sm bg-background border border-border text-foreground rounded-lg hover:bg-background/80 transition-colors"
              >
                Run Another Inference
              </button>
            </div>
          )}

          {/* Empty State */}
          {!model && (
            <div className="flex flex-col items-center gap-4 py-8 text-center text-muted-foreground">
              <AlertCircle className="w-12 h-12 opacity-20" />
              <p>Upload an ML model to begin evaluation</p>
              <p className="text-xs">Supported formats: PyTorch (.pth), Pickle (.pkl), and others</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
