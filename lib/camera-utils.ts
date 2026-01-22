export class RPPGAcquisition {
    private frameInterval: number;
    private lastProcess: number = 0;
  
    constructor(targetFps: number = 30) {
      this.frameInterval = 1000 / targetFps;
    }
  
    /**
     * Request Camera with specific mobile constraints
     * - Requires HTTPS
     * - Requests Rear Camera
     * - Tries to enable TORCH (Flashlight)
     */
    async requestCameraPermission(): Promise<MediaStream> {
      // 1. Safety Check: Camera requires Secure Context (HTTPS or localhost)
      if (typeof window !== 'undefined' && 
          window.location.protocol !== 'https:' && 
          window.location.hostname !== 'localhost') {
        throw new Error("Camera access requires HTTPS. Please deploy with SSL.");
      }
  
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser API not supported");
      }
  
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          // 'environment' forces the rear camera on phones
          facingMode: 'environment', 
          // Ideal resolution for processing (too high = slow, too low = bad signal)
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        }
      };
  
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // 2. TORCH ACTIVATION (Crucial for PPG)
        const track = stream.getVideoTracks()[0];
        try {
          const capabilities = track.getCapabilities() as any; // Cast to any for 'torch'
          if (capabilities.torch) {
            // Apply torch constraint
            await track.applyConstraints({
              advanced: [{ torch: true } as any] 
            });
            console.log("Torch activated");
          } else {
            console.warn("Device does not support torch/flashlight");
          }
        } catch (e) {
          console.warn("Failed to activate torch:", e);
        }
  
        return stream;
      } catch (err) {
        console.error("Camera Error:", err);
        throw err;
      }
    }
  
    /**
     * Extract average Red channel intensity from the video frame
     */
    extractSignal(video: HTMLVideoElement): number {
      const now = Date.now();
      if (now - this.lastProcess < this.frameInterval) return 0; // Skip if too fast
      this.lastProcess = now;
  
      const canvas = document.createElement('canvas');
      // Use small dimensions for performance
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (!ctx) return 0;
  
      // Draw center crop of video
      // This focuses on the center where the finger usually is
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = frame.data;
      
      let sumRed = 0;
      let count = 0;
  
      // Sample pixels (step by 4 for speed)
      for (let i = 0; i < data.length; i += 16) {
        // PPG relies mostly on the Red Channel (index 0)
        // Green (1) is good too, but Red penetrates skin deeper
        sumRed += data[i]; 
        count++;
      }
  
      const avg = count > 0 ? sumRed / count : 0;
      return avg;
    }
  }
  
  export function generateSimulatedSignal(baseHeartRate: number, samplingRate: number, seconds: number): number[] {
    const samples = samplingRate * seconds;
    const signal: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = i / samplingRate;
      // Simulating a PPG wave: DC offset + Pulse + Respiratory drift + Noise
      const pulse = -Math.cos(2 * Math.PI * (baseHeartRate / 60) * t); // Main beat
      const dicrotic = 0.5 * Math.cos(2 * Math.PI * (baseHeartRate / 60) * 2 * t + 0.5); // Secondary notch
      const resp = 0.2 * Math.sin(2 * Math.PI * 0.25 * t); // Breathing
      const noise = (Math.random() - 0.5) * 0.1; // Jitter
      
      signal.push(100 + 10 * (pulse + dicrotic + resp + noise));
    }
    return signal;
  }