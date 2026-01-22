'use client';

import { useEffect, useRef } from 'react';

interface SignalVisualizerProps {
  rawSignal: number[];
  filteredSignal: number[];
  title: string;
  maxDataPoints?: number;
  color?: 'cyan' | 'emerald';
  height?: number;
}

export default function SignalVisualizer({
  rawSignal,
  filteredSignal,
  title,
  maxDataPoints = 300,
  color = 'cyan',
  height = 150,
}: SignalVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = height;

    const width = canvas.width;
    const h = canvas.height;
    const padding = 10;

    // Clear canvas
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(0, 0, width, h);

    // Draw grid
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.3)';
    ctx.lineWidth = 1;

    // Vertical grid lines
    for (let i = 0; i < width; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
    }

    // Horizontal grid lines
    for (let i = 0; i < h; i += 40) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(width, i);
      ctx.stroke();
    }

    // Draw border
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, h);

    // Use appropriate signal
    const data = filteredSignal.length > 0 ? filteredSignal : rawSignal;
    if (data.length === 0) return;

    // Limit data points for performance
    const displayData = data.slice(-maxDataPoints);

    // Find min and max for scaling
    const min = Math.min(...displayData);
    const max = Math.max(...displayData);
    const range = max - min || 1;

    // Draw signal
    const colorMap = {
      cyan: 'rgb(6, 182, 212)',
      emerald: 'rgb(16, 185, 129)',
    };

    ctx.strokeStyle = colorMap[color];
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    displayData.forEach((value, index) => {
      // Normalize value to canvas height
      const x = (index / displayData.length) * (width - padding * 2) + padding;
      const y = h - ((value - min) / range) * (h - padding * 2) - padding;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw legend
    ctx.fillStyle = colorMap[color];
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Min: ${min.toFixed(2)}`, width - 5, 20);
    ctx.fillText(`Max: ${max.toFixed(2)}`, width - 5, 35);
    ctx.fillText(`Samples: ${displayData.length}`, width - 5, 50);
  }, [rawSignal, filteredSignal, maxDataPoints, color, height]);

  return (
    <div className="w-full bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-background/50">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{ height: `${height}px` }}
      />
    </div>
  );
}
