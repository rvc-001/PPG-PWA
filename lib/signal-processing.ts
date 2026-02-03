/**
 * ROBUST SIGNAL PROCESSING FOR PPG
 * Implements 4th Order Butterworth LowPass + Refractory Peak Detection
 */

export interface SignalSample {
  timestamp: number;
  value: number;
}

export interface FilterConfig {
  samplingRate: number; // Hz (e.g. 30)
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
 * 4th Order Butterworth LowPass Filter (4Hz Cutoff at 30Hz)
 * Removes high-frequency camera noise (jitter) that causes false HR peaks.
 */
class ButterworthLowPass {
  // Coefficients for 4Hz cutoff @ 30Hz sampling
  // Calculated via standard biquad formulas
  private readonly b = [0.0048, 0.0193, 0.0289, 0.0193, 0.0048];
  private readonly a = [1.0000, -2.3695, 2.3140, -1.0547, 0.1874];

  // History buffers (x = input, y = output)
  private x: number[] = [0, 0, 0, 0, 0];
  private y: number[] = [0, 0, 0, 0, 0];

  public process(input: number): number {
    // Shift history
    this.x.unshift(input); this.x.pop();
    this.y.unshift(0);     this.y.pop(); // Placeholder for new output

    // Difference Equation
    const output = 
      (this.b[0]*this.x[0] + this.b[1]*this.x[1] + this.b[2]*this.x[2] + this.b[3]*this.x[3] + this.b[4]*this.x[4]) -
      (this.a[1]*this.y[1] + this.a[2]*this.y[2] + this.a[3]*this.y[3] + this.a[4]*this.y[4]);

    this.y[0] = output;
    return output;
  }
}

/**
 * Main Real-time Filter Class
 * Chain: DC Blocker (0.5Hz) -> Butterworth LowPass (4Hz)
 */
export class RealTimeFilter {
  private prevX = 0;
  private prevY = 0;
  private alpha = 0.9; // Fast DC blocker
  private isInitialized = false;
  
  private lpf = new ButterworthLowPass();

  constructor() { this.reset(); }

  public reset() {
    this.prevX = 0; this.prevY = 0;
    this.isInitialized = false;
    this.lpf = new ButterworthLowPass(); // Reset LPF state
  }

  public process(raw: number): number {
    // 0. Init Step: Lock onto the DC offset instantly
    if (!this.isInitialized) {
      this.prevX = raw;
      this.isInitialized = true;
      // Pre-load the filter to avoid "startup spike"
      for (let i = 0; i < 10; i++) this.lpf.process(0);
      return 0;
    }

    // 1. DC Blocker (High Pass 0.5Hz) - Removes gravity/lighting drift
    const dcBlocked = raw - this.prevX + this.alpha * this.prevY;
    this.prevX = raw;
    this.prevY = dcBlocked;

    // 2. Butterworth Low Pass (4Hz) - Removes the "Jitter"
    const filtered = this.lpf.process(dcBlocked);

    return filtered;
  }
  // REMOVED GARBAGE METHOD HERE
}

/**
 * Filter Array Helper
 */
export function applyFilterToArray(data: number[], config?: FilterConfig): number[] {
  if (!data || data.length === 0) return [];
  const filter = new RealTimeFilter();
  // Warmup not strictly needed with new init logic, but good for safety
  return data.map(v => filter.process(v));
}

/**
 * Improved BP & HR Estimator
 * Includes Refractory Period to stop "170 HR" noise readings
 */
export function estimateBloodPressure(signal: number[], samplingRate: number = 30) {
  if (signal.length < 60) return { sbp: 120, dbp: 80, hr: 0 };

  // 1. Robust Peak Detection
  const peaks: number[] = [];
  const minDistance = Math.floor(samplingRate * 0.25); // 250ms refractory period (Max ~240 BPM)
  let lastPeakIndex = -minDistance;

  // Calculate local threshold (signal strength)
  const mean = signal.reduce((a,b)=>a+b,0)/signal.length;
  
  for (let i = 2; i < signal.length - 2; i++) {
    // Must be a local max
    if (signal[i] > signal[i-1] && signal[i] > signal[i-2] && 
        signal[i] > signal[i+1] && signal[i] > signal[i+2]) {
      
      // Must be above baseline (ignore ripples in the valley)
      if (signal[i] > mean) {
         // Must respect refractory period
         if ((i - lastPeakIndex) > minDistance) {
           peaks.push(i);
           lastPeakIndex = i;
         }
      }
    }
  }

  if (peaks.length < 2) return { sbp: 120, dbp: 80, hr: 0 };

  // 2. Calculate Robust HR
  const durations = [];
  for (let i = 1; i < peaks.length; i++) {
    durations.push(peaks[i] - peaks[i-1]);
  }
  const avgDurationSamples = durations.reduce((a, b) => a + b, 0) / durations.length;
  let hr = Math.round(60 * (samplingRate / avgDurationSamples));

  // 3. Estimate BP (Heuristic)
  let sbp = 110;
  let dbp = 70;

  // HR adjustment (Tachycardia increases BP usually)
  if (hr > 80 && hr < 180) { sbp += (hr - 80) * 0.5; dbp += (hr - 80) * 0.3; }
  if (hr < 60 && hr > 30) { sbp -= (60 - hr) * 0.5; dbp -= (60 - hr) * 0.3; }

  // Clamp values to realistic ranges
  hr = Math.max(40, Math.min(180, hr));
  sbp = Math.max(90, Math.min(180, sbp));
  dbp = Math.max(60, Math.min(110, dbp));

  return { sbp: Math.round(sbp), dbp: Math.round(dbp), hr };
}

export function calculateSignalStats(signal: number[]) {
  if (!signal || signal.length === 0) return { min: 0, max: 0, mean: 0, std: 0, variance: 0 };
  const min = Math.min(...signal);
  const max = Math.max(...signal);
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
  const std = Math.sqrt(variance);
  return { min, max, mean, std, variance };
}

export function assessSignalQuality(signal: number[]): 'Good' | 'Usable' | 'Bad' {
  if (!signal || signal.length < 30) return 'Bad';
  const stats = calculateSignalStats(signal);
  // Std deviation too low = no pulse detected
  if (stats.std < 0.01) return 'Bad';
  return 'Good';
}

export function generateMIMICCSV(session: RecordingSession, start?: number, end?: number): string {
  const data = start !== undefined && end !== undefined 
    ? session.rawSignal.filter(s => s.timestamp >= start && s.timestamp <= end)
    : session.rawSignal;
  
  const filtered = applyFilterToArray(data.map(s => s.value));

  let csv = `# MIMIC-III PPG Export\n# ID: ${session.id}\n# BP: ${session.sbp}/${session.dbp}\nTime,Pleth,Filtered\n`;
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
      r.onupgradeneeded = (e: any) => { e.target.result.createObjectStore(this.storeName, { keyPath: 'id' }); };
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

  async getSession(id: string): Promise<RecordingSession | undefined> {
    const db = await this.init();
    return new Promise((res, rej) => {
      const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(id);
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
      tx.onerror = () => rej(tx.error);
    });
  }

  // --- ADDED METHOD ---
  async clearAll() {
    const db = await this.init();
    return new Promise<void>((res, rej) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
}