// © 2026 CapAI — All Rights Reserved. Viewing only.
import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import "./globals.css";

// Waldenburg Light fallback — licensed, so EB Garamond at 400/500 approximates editorial light voice.
// Weight 300 requested per spec; EB Garamond serves at 400 with optical lightness.
const ebGaramond = EB_Garamond({
  variable: "--font-eb",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CapAI — AI Captions, Burned In.",
  description:
    "Generate and burn styled video captions in your browser — AI transcription with Gemini 2.5 Flash, client-side encoding with FFmpeg.wasm. No server, no upload.",
  keywords: ["captions", "subtitles", "AI", "transcription", "FFmpeg", "video"],
};

import SiteHeader from "@/components/layout/SiteHeader";
import QuickSettingsModal from "@/components/modals/QuickSettingsModal";
import SettingsWindow from "@/components/modals/SettingsWindow";
import LangDirSync from "@/components/LangDirSync";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" className={`${ebGaramond.variable} ${inter.variable} light`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col bg-[var(--canvas)] text-[var(--ink)] antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-pill focus:bg-[var(--surface-card)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 focus:ring-offset-[var(--canvas)]"
        >
          Skip to main content
        </a>
        {/* Global top-nav — ElevenLabs editorial spec: 64px, canvas, hairline, wordmark left, nav center, primary pill right — single sticky header (z-50 solid canvas prevents bleed-through; body flex-col + flex-1 wrapper ensures EditorShell calc(100vh-64px) sits exactly below sticky header with no negative margin / no mt-[-64px]) */}
        <SiteHeader />
        <LangDirSync />
        <div className="flex flex-1 min-h-0 flex-col">
          {children}
        </div>
        <QuickSettingsModal />
        <SettingsWindow />
      </body>
    </html>
  );
}
