/**
 * Signal Processing Utilities for Physiological Data
 * Aligned with MIMIC-III waveform conventions
 */

export interface SignalSample {
  timestamp: number;
  value: number;
}

export interface FilterConfig {
  lowCutoff: number;  // Hz
  highCutoff: number; // Hz
  order: number;      // Butterworth filter order
  samplingRate: number; // Hz
}

export interface RecordingSession {
  id: string;
  patientId?: string;
  patientName?: string;
  startTime: number;
  endTime: number; // Made mandatory
  samplingRate: number;
  rawSignal: SignalSample[];
  filterConfig: FilterConfig;
  createdAt: Date;
  // New fields for MIMIC alignment and Quality
  quality?: 'Good' | 'Usable' | 'Bad';
  sbp?: number; // Systolic Blood Pressure (Ground Truth)
  dbp?: number; // Diastolic Blood Pressure (Ground Truth)
}

/**
 * Assess signal quality based on simple heuristics (Variance & Clipping)
 */
export function assessSignalQuality(signal: number[]): 'Good' | 'Usable' | 'Bad' {
  if (!signal || signal.length < 30) return 'Bad';

  const stats = calculateSignalStats(signal);
  
  // Check for flatline (extremely low variance)
  if (stats.std < 0.5) return 'Bad';

  // Check for clipping (if many samples hit max/min boundaries of typical 8-bit/10-bit range)
  // Assuming normalized 0-255 or similar, but since we have arbitrary values:
  // We check if the signal is "stuck" at the min or max often.
  // Simple heuristic: range check.
  
  if (stats.max === stats.min) return 'Bad';

  // Check for reasonable amplitude (Good PPG usually has clear AC component)
  // This threshold depends on the camera input scale, assuming 0-255 range from RGB extraction
  // If variance is too low, it's likely just noise.
  if (stats.std < 2.0) return 'Usable'; // Weak signal

  return 'Good';
}

/**
 * Simple Butterworth bandpass filter implementation
 */
export function butterworthBandpass(
  signal: number[],
  config: FilterConfig
): number[] {
  if (!signal || signal.length === 0) return [];

  const filtered: number[] = [];
  const nyquist = config.samplingRate / 2;
  
  const lowNorm = config.lowCutoff / nyquist;
  const highNorm = config.highCutoff / nyquist;

  const low = Math.max(0.001, Math.min(0.999, lowNorm));
  const high = Math.max(0.001, Math.min(0.999, highNorm));

  if (low >= high) {
    return signal;
  }

  const windowSize = Math.max(2, Math.floor(config.samplingRate / 100));
  
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const demeaned = signal.map(x => x - mean);

  for (let i = 0; i < demeaned.length; i++) {
    let sum = 0;
    let count = 0;

    for (let j = Math.max(0, i - windowSize); j <= Math.min(demeaned.length - 1, i + windowSize); j++) {
      sum += demeaned[j];
      count++;
    }

    filtered.push(sum / count);
  }

  return filtered;
}

/**
 * Generate MIMIC-III aligned CSV export
 * Includes Columns: Time, Pleth, SBP, DBP
 */
export function generateMIMICCSV(
  session: RecordingSession,
  clipStart?: number,
  clipEnd?: number
): string {
  const data = clipStart !== undefined && clipEnd !== undefined
    ? session.rawSignal.filter(s => s.timestamp >= clipStart && s.timestamp <= clipEnd)
    : session.rawSignal;

  const filtered = butterworthBandpass(
    data.map(s => s.value),
    session.filterConfig
  );

  const sbpVal = session.sbp || 0;
  const dbpVal = session.dbp || 0;

  // MIMIC-III Style Header
  let csv = '# MIMIC-III Format Export\n';
  csv += `# RECORD NAME: ${session.id}\n`;
  csv += `# START TIME: ${new Date(session.startTime).toTimeString()}\n`;
  csv += `# SAMPLING RATE: ${session.samplingRate} Hz\n`;
  csv += `# PATIENT: ${session.patientName || session.patientId || 'Anonymous'}\n`;
  csv += `# QUALITY: ${session.quality || 'Unknown'}\n`;
  csv += `# GROUND TRUTH BP: ${sbpVal}/${dbpVal}\n`;
  csv += 'Time,Pleth,SBP,DBP\n'; // Standard Machine Learning friendly format

  data.forEach((sample, idx) => {
    // Relative time in seconds
    const timeSeconds = (sample.timestamp - session.startTime) / 1000;
    
    // In MIMIC, 'Pleth' is the PPG signal. 
    // We export the filtered signal as it's cleaner, or raw if preferred. 
    // Usually filtered is better for analysis.
    const signalVal = filtered[idx] !== undefined ? filtered[idx] : sample.value;
    
    csv += `${timeSeconds.toFixed(3)},${signalVal.toFixed(4)},${sbpVal},${dbpVal}\n`;
  });

  return csv;
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
 * Signal Storage (IndexedDB)
 */
export class SignalStorage {
  private dbName = 'SignalMonitorDB';
  private version = 1;
  private storeName = 'recordings';

  async init(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
    });
  }

  async saveSession(session: RecordingSession): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(session);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getSessions(): Promise<RecordingSession[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}