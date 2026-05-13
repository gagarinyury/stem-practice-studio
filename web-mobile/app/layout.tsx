import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Stem Practice Studio",
  description: "Music learning with stem separation and karaoke-style lyrics",
};

// App-like behavior on iOS/WKWebView: disable pinch-zoom and double-tap zoom
// (the latter eats button taps in Capacitor). viewportFit cover lets us paint
// under the home indicator while env(safe-area-inset-*) keeps content above it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${cormorant.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
