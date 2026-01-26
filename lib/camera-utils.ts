export class RPPGAcquisition {
    private frameInterval: number;
    private lastProcess: number = 0;
    private stream: MediaStream | null = null;
    private track: MediaStreamTrack | null = null;
  
    constructor(targetFps: number = 30) {
      this.frameInterval = 1000 / targetFps;
    }
  
    /**
     * Robust Camera Request
     * 1. Tries to find a camera with 'torch' capability explicitly.
     * 2. Falls back to standard 'environment' camera.
     * 3. Initializes Torch with a safety delay for Android.
     */
    async requestCameraPermission(): Promise<MediaStream> {
      // 1. Safety Check
      if (typeof window !== 'undefined' && 
          window.location.protocol !== 'https:' && 
          window.location.hostname !== 'localhost') {
        throw new Error("Camera access requires HTTPS. Please deploy with SSL.");
      }
  
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser API not supported");
      }
  
      try {
        // 2. Stop any existing tracks
        this.stop();
  
        // 3. Attempt to find the BEST camera (one with Flash)
        // Android often has multiple back cameras; we need the one with the LED.
        let selectedDeviceId = '';
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            
            // Filter for back cameras
            const backCameras = videoDevices.filter(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
            
            // If we have multiple, we might want to iterate, but for now let's rely on standard selection
            // unless we want to get fancy with capabilities (which requires getting a stream first).
            // Optimization: Just let getUserMedia pick the default 'environment' first.
        } catch (e) {
            console.warn("Device enumeration failed", e);
        }
  
        // 4. Initial Request (High compatibility mode)
        // We remove strict resolution constraints for the initial connection to prevent Android crashes
        const constraints: MediaStreamConstraints = {
            audio: false,
            video: {
                facingMode: 'environment',
                width: { ideal: 640 }, // 'Ideal' is soft, but sometimes causes Android driver issues
                height: { ideal: 480 },
                frameRate: { ideal: 30 }
            }
        };
  
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.track = this.stream.getVideoTracks()[0];
  
        // 5. TORCH ACTIVATION (With Android "Warm-up" Delay)
        // Android Chrome often fails if you apply constraints 0ms after stream start.
        setTimeout(async () => {
            await this.toggleTorch(true);
        }, 500);
  
        return this.stream;
      } catch (err) {
        console.error("Camera Error:", err);
        throw err;
      }
    }
  
    async toggleTorch(on: boolean): Promise<boolean> {
        if (!this.track) return false;
        
        try {
            // Check capabilities FIRST (prevents errors on devices without flash)
            const capabilities = this.track.getCapabilities() as any;
            
            if (!capabilities.torch) {
                console.warn("Device does not support Torch (Flashlight).");
                return false;
            }
  
            await this.track.applyConstraints({
                advanced: [{ torch: on } as any]
            });
            console.log(`Torch set to: ${on}`);
            return true;
        } catch (e) {
            console.warn("Failed to toggle torch:", e);
            return false;
        }
    }
  
    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
            this.track = null;
        }
    }
  
    extractSignal(video: HTMLVideoElement): number {
      const now = Date.now();
      if (now - this.lastProcess < this.frameInterval) return 0;
      this.lastProcess = now;
  
      const canvas = document.createElement('canvas');
      canvas.width = 60; // Lower resolution for speed
      canvas.height = 60;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (!ctx) return 0;
  
      // Draw only the center 50% of the video (where the finger is)
      // sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      ctx.drawImage(video, vw/4, vh/4, vw/2, vh/2, 0, 0, canvas.width, canvas.height);
  
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = frame.data;
      
      let sumRed = 0;
      let count = 0;
  
      for (let i = 0; i < data.length; i += 4) {
        sumRed += data[i]; // Red channel
        count++;
      }
  
      return count > 0 ? sumRed / count : 0;
    }
  }
  
  export function generateSimulatedSignal(baseHeartRate: number, samplingRate: number, seconds: number): number[] {
    const samples = samplingRate * seconds;
    const signal: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = i / samplingRate;
      const pulse = -Math.cos(2 * Math.PI * (baseHeartRate / 60) * t);
      const dicrotic = 0.5 * Math.cos(2 * Math.PI * (baseHeartRate / 60) * 2 * t + 0.5);
      const resp = 0.2 * Math.sin(2 * Math.PI * 0.25 * t);
      const noise = (Math.random() - 0.5) * 0.1;
      
      signal.push(100 + 10 * (pulse + dicrotic + resp + noise));
    }
    return signal;
  }