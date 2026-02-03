import React from "react"
import type { Metadata, Viewport } from 'next' 
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import PWARegister from '@/components/pwa/pwa-register'
import { ThemeProvider } from '@/components/theme-provider' //
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  colorScheme: 'dark',
  themeColor: '#0f172a',
}

export const metadata: Metadata = {
  title: 'Signal Monitor - Physiological Signal Acquisition',
  description: 'Medical-grade PWA for physiological signal acquisition, analysis, and ML-based prediction aligned with MIMIC-III standards',
  generator: 'v0.app',
  manifest: '/manifest.json',
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
    // Add suppressHydrationWarning to html to prevent mismatch errors with next-themes
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Signal Monitor" />
      </head>
      <body className={`font-sans antialiased`}>
        {/* Wrap children with ThemeProvider */}
        <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
          {children}
          <PWARegister />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  )
}