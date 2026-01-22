import React from "react"
// Add Viewport to the import
import type { Metadata, Viewport } from 'next' 
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import PWARegister from '@/components/pwa/pwa-register'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

// 1. Create the separate viewport export
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  colorScheme: 'dark',
  themeColor: '#0f172a', // Moved from <meta name="theme-color" />
}

export const metadata: Metadata = {
  title: 'Signal Monitor - Physiological Signal Acquisition',
  description: 'Medical-grade PWA for physiological signal acquisition, analysis, and ML-based prediction aligned with MIMIC-III standards',
  generator: 'v0.app',
  manifest: '/manifest.json',
  // 2. Remove the viewport object from here
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Signal Monitor',
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        {/* 3. Remove the theme-color meta tag as it is now in the viewport export */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Signal Monitor" />
      </head>
      <body className={`font-sans antialiased`}>
        {children}
        <PWARegister />
        <Analytics />
      </body>
    </html>
  )
}