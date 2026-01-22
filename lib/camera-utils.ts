/**
 * Camera and rPPG (remote Photoplethysmography) signal acquisition
 * Extracts physiological signals from camera feed
 */

export interface CameraConfig {
  width: number;
  height: number;
  frameRate: number;
  facingMode: 'user' | 'environment';
}

export class RPPGAcquisition {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private samplingRate: number;
  private signalBuffer: number[] = [];
  private roi = {
    x: 0.3,
    y: 0.2,
    width: 0.4,
    height: 0.4,
  };

  constructor(samplingRate: number = 30) {
    this.samplingRate = samplingRate;
  }

  /**
   * Request camera permission and initialize
   */
  async requestCameraPermission(): Promise<MediaStream> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      return stream;
    } catch (error) {
      console.error('Camera permission denied or error:', error);
      throw error;
    }
  }

  /**
   * Extract green channel signal from video frame (rPPG approach)
   */
  extractSignal(videoElement: HTMLVideoElement): number {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }

    const width = videoElement.videoWidth;
    const height = videoElement.videoHeight;

    this.canvas.width = width;
    this.canvas.height = height;

    if (!this.ctx) return 0;

    // Draw current frame
    this.ctx.drawImage(videoElement, 0, 0, width, height);
    const imageData = this.ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Region of Interest (forehead region for best PPG signal)
    const roiX = Math.floor(width * this.roi.x);
    const roiY = Math.floor(height * this.roi.y);
    const roiW = Math.floor(width * this.roi.width);
    const roiH = Math.floor(height * this.roi.height);

    let greenSum = 0;
    let pixelCount = 0;

    // Extract green channel from ROI
    for (let y = roiY; y < roiY + roiH; y++) {
      for (let x = roiX; x < roiX + roiW; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const idx = (y * width + x) * 4;
          // Green is at idx + 1
          greenSum += data[idx + 1];
          pixelCount++;
        }
      }
    }

    // Average green channel value (0-255)
    const avgGreen = pixelCount > 0 ? greenSum / pixelCount : 128;

    // Normalize to [-1, 1] range for signal processing
    const normalized = (avgGreen - 128) / 128;

    this.signalBuffer.push(normalized);

    return normalized;
  }

  /**
   * Get accumulated signal buffer and clear it
   */
  getSignalBuffer(): number[] {
    const buffer = [...this.signalBuffer];
    this.signalBuffer = [];
    return buffer;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.canvas = null;
    this.ctx = null;
    this.signalBuffer = [];
  }
}

/**
 * Simulate signal acquisition for testing (when camera unavailable)
 */
export function generateSimulatedSignal(
  baselineHR: number = 70,
  samplingRate: number = 30,
  duration: number = 60
): number[] {
  const samples = Math.floor(samplingRate * duration);
  const signal: number[] = [];

  // Generate realistic PPG-like signal
  for (let i = 0; i < samples; i++) {
    const t = i / samplingRate;
    const heartRateFreq = baselineHR / 60; // Hz

    // Cardiac component (main PPG signal)
    const cardiac = 0.7 * Math.sin(2 * Math.PI * heartRateFreq * t);

    // Respiratory component
    const respiratory = 0.2 * Math.sin(2 * Math.PI * 0.25 * t);

    // High-frequency noise
    const noise = 0.1 * (Math.random() - 0.5);

    signal.push(cardiac + respiratory + noise);
  }

  return signal;
}
