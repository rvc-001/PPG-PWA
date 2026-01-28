/** @type {import('next').NextConfig} */
const nextConfig = {
  // 1. Prevent server-side crash with ONNX Runtime
  serverExternalPackages: ['onnxruntime-web'], 
  
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig;