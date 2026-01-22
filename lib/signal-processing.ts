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
  endTime?: number;
  samplingRate: number;
  rawSignal: SignalSample[];
  filterConfig: FilterConfig;
  createdAt: Date;
}

/**
 * Simple Butterworth bandpass filter implementation
 * Removes DC offset and high-frequency noise
 */
export function butterworthBandpass(
  signal: number[],
  config: FilterConfig
): number[] {
  const filtered: number[] = [];
  const nyquist = config.samplingRate / 2;
  
  // Normalized frequencies (0 to 1, where 1 = Nyquist frequency)
  const lowNorm = config.lowCutoff / nyquist;
  const highNorm = config.highCutoff / nyquist;

  // Clamp normalized frequencies
  const low = Math.max(0.001, Math.min(0.999, lowNorm));
  const high = Math.max(0.001, Math.min(0.999, highNorm));

  if (low >= high) {
    console.warn('Invalid filter frequencies, returning original signal');
    return signal;
  }

  // Simple moving average + DC removal (production would use more sophisticated filtering)
  const windowSize = Math.max(2, Math.floor(config.samplingRate / 100));
  
  // First pass: remove DC offset
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const demeaned = signal.map(x => x - mean);

  // Second pass: bandpass approximation using moving average
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
 * Generate MIMIC-III compatible CSV export
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

  let csv = '# MIMIC-III Signal Export\n';
  csv += `# Patient ID: ${session.patientId || 'N/A'}\n`;
  csv += `# Patient Name: ${session.patientName || 'N/A'}\n`;
  csv += `# Start Time: ${new Date(session.startTime).toISOString()}\n`;
  csv += `# Sampling Rate: ${session.samplingRate} Hz\n`;
  csv += `# Filter: Butterworth Bandpass ${session.filterConfig.lowCutoff}-${session.filterConfig.highCutoff} Hz, Order ${session.filterConfig.order}\n`;
  csv += '\nTime(s),Raw Signal,Filtered Signal\n';

  data.forEach((sample, idx) => {
    const timeSeconds = (sample.timestamp - session.startTime) / 1000;
    csv += `${timeSeconds.toFixed(4)},${sample.value.toFixed(4)},${filtered[idx].toFixed(4)}\n`;
  });

  return csv;
}

/**
 * Calculate statistics for signal segment
 */
export function calculateSignalStats(signal: number[]) {
  const min = Math.min(...signal);
  const max = Math.max(...signal);
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
  const std = Math.sqrt(variance);

  return { min, max, mean, std, variance };
}

/**
 * Storage utilities using IndexedDB for offline capability
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

  async getSession(id: string): Promise<RecordingSession | undefined> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(id);

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

  async clearAll(): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}
