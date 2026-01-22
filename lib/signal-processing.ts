/**
 * ROBUST SIGNAL PROCESSING FOR PPG
 */

export interface SignalSample {
  timestamp: number;
  value: number;
}

export interface FilterConfig {
  samplingRate: number; // Hz (e.g. 30)
  lowCutoff?: number;
  highCutoff?: number;
  order?: number;
}

export interface RecordingSession {
  id: string;
  patientId?: string;
  patientName?: string;
  startTime: number;
  endTime: number;
  samplingRate: number;
  rawSignal: SignalSample[];
  filterConfig: FilterConfig;
  createdAt: Date;
  quality?: 'Good' | 'Usable' | 'Bad';
  sbp?: number;
  dbp?: number;
}

/**
 * Robust Real-time Filter for PPG
 * Chain: DC Blocker -> Moving Average Smoother
 */
export class RealTimeFilter {
  // DC Blocker State
  private prevX = 0;
  private prevY = 0;
  private alpha = 0.95; // Controls low-frequency cutoff (~0.5Hz)

  // Smoothing State (Simple Moving Average)
  private buffer: number[] = [];
  private windowSize = 5; // 5-tap smooth (removes jitter)

  constructor() {
    this.reset();
  }

  public reset() {
    this.prevX = 0;
    this.prevY = 0;
    this.buffer = [];
  }

  public process(raw: number): number {
    // 1. DC BLOCKER (Removes gravity/offset)
    // y[n] = x[n] - x[n-1] + alpha * y[n-1]
    const dcBlocked = raw - this.prevX + this.alpha * this.prevY;
    
    // Update state
    this.prevX = raw;
    this.prevY = dcBlocked;

    // 2. SMOOTHING (Removes jagged noise)
    this.buffer.push(dcBlocked);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }

    // Average the buffer
    const smoothed = this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length;

    return smoothed;
  }
}

/**
 * Filter an entire array (for History/Export)
 * Accepts config to satisfy interface, but uses robust defaults
 */
export function applyFilterToArray(data: number[], config?: FilterConfig): number[] {
  if (!data || data.length === 0) return [];
  const filter = new RealTimeFilter();
  // Warm up to stabilize DC blocker
  for(let i=0; i<20; i++) filter.process(data[0]);
  
  return data.map(v => filter.process(v));
}

/**
 * Estimate Blood Pressure from PPG Signal Features
 */
export function estimateBloodPressure(signal: number[], samplingRate: number = 30) {
  // FIX: Added hr: 0 to the default return to satisfy TypeScript
  if (signal.length < 60) return { sbp: 120, dbp: 80, hr: 0 };

  // 1. Find Peaks (Systolic Points)
  const peaks: number[] = [];
  for (let i = 2; i < signal.length - 2; i++) {
    if (signal[i] > signal[i-1] && signal[i] > signal[i-2] && 
        signal[i] > signal[i+1] && signal[i] > signal[i+2]) {
      peaks.push(i);
    }
  }

  if (peaks.length < 2) return { sbp: 120, dbp: 80, hr: 0 };

  // 2. Calculate Heart Rate (BPM)
  const durations = [];
  for (let i = 1; i < peaks.length; i++) {
    durations.push(peaks[i] - peaks[i-1]);
  }
  const avgDurationSamples = durations.reduce((a, b) => a + b, 0) / durations.length;
  const hr = 60 * (samplingRate / avgDurationSamples);

  // 3. Heuristic Model for BP
  let estimatedSBP = 110;
  let estimatedDBP = 70;

  if (hr > 80) { estimatedSBP += (hr - 80) * 0.5; estimatedDBP += (hr - 80) * 0.3; }
  if (hr < 60) { estimatedSBP -= (60 - hr) * 0.5; estimatedDBP -= (60 - hr) * 0.3; }

  return {
    sbp: Math.round(estimatedSBP),
    dbp: Math.round(estimatedDBP),
    hr: Math.round(hr)
  };
}

/**
 * Calculate statistics for signal segment
 */
export function calculateSignalStats(signal: number[]) {
  if (!signal || signal.length === 0) {
    return { min: 0, max: 0, mean: 0, std: 0, variance: 0 };
  }

  const min = Math.min(...signal);
  const max = Math.max(...signal);
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
  const std = Math.sqrt(variance);

  return { min, max, mean, std, variance };
}

/**
 * Assess Quality
 */
export function assessSignalQuality(signal: number[]): 'Good' | 'Usable' | 'Bad' {
  if (!signal || signal.length < 30) return 'Bad';
  
  const stats = calculateSignalStats(signal);

  // After DC blocking, signal is centered at 0.
  // Standard Deviation check:
  if (stats.std < 0.05) return 'Bad'; // Flatline
  if (stats.std > 100) return 'Bad';  // Motion artifact

  return 'Good';
}

/**
 * Generate CSV
 */
export function generateMIMICCSV(session: RecordingSession, start?: number, end?: number): string {
  const data = start !== undefined && end !== undefined 
    ? session.rawSignal.filter(s => s.timestamp >= start && s.timestamp <= end)
    : session.rawSignal;

  const filtered = applyFilterToArray(data.map(s => s.value));

  let csv = `# MIMIC-III PPG Export\n# RECORD: ${session.id}\n# DATE: ${new Date(session.startTime).toISOString()}\n# BP_EST: ${session.sbp}/${session.dbp}\nTime,Pleth,Filtered\n`;
  
  data.forEach((s, i) => {
    csv += `${((s.timestamp - session.startTime)/1000).toFixed(3)},${s.value.toFixed(2)},${filtered[i].toFixed(4)}\n`;
  });
  return csv;
}

export class SignalStorage {
  private dbName = 'SignalMonitorDB';
  private storeName = 'recordings';
  async init(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const r = indexedDB.open(this.dbName, 1);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => res(r.result);
      r.onupgradeneeded = (e: any) => {
        e.target.result.createObjectStore(this.storeName, { keyPath: 'id' });
      };
    });
  }
  async saveSession(s: RecordingSession) {
    const db = await this.init();
    return new Promise<void>((res, rej) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(s);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async getSessions(): Promise<RecordingSession[]> {
    const db = await this.init();
    return new Promise((res, rej) => {
      const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async deleteSession(id: string) {
    const db = await this.init();
    return new Promise<void>((res, rej) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(id);
      tx.oncomplete = () => res();
    });
  }
}