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

// Tiny on-page console for iOS/Capacitor debugging. Wraps console.* and
// window error handlers BEFORE React loads, so we see bundle parse errors,
// hydration errors, anything. Renders a floating panel at the bottom.
const onPageConsole = `
(function(){
  if (window.__opc_installed) return; window.__opc_installed = true;
  var lines = [];
  var box;
  function ensure(){
    if (box) return box;
    box = document.createElement('div');
    box.id='__opc';
    box.style.cssText='position:fixed;left:4px;right:4px;bottom:4px;max-height:50vh;overflow:auto;z-index:2147483647;background:rgba(0,0,0,0.9);color:#0f0;font:10px/1.3 ui-monospace,monospace;padding:6px;border-radius:6px;white-space:pre-wrap;word-break:break-all;pointer-events:auto';
    box.onclick = function(e){ e.stopPropagation(); };
    document.body && document.body.appendChild(box);
    return box;
  }
  function write(){
    var b = ensure(); if (!b) return;
    b.textContent = lines.slice(-80).join('\\n');
    b.scrollTop = b.scrollHeight;
  }
  function fmt(args){
    return Array.prototype.map.call(args, function(a){
      try { return typeof a==='string'?a:JSON.stringify(a); } catch(_) { return String(a); }
    }).join(' ');
  }
  function push(tag, args){
    var t = new Date().toISOString().slice(11,19);
    lines.push('['+t+'] '+tag+' '+fmt(args));
    if (document.body) write();
  }
  ['log','warn','error','info'].forEach(function(k){
    var orig = console[k].bind(console);
    console[k] = function(){ push(k.toUpperCase(), arguments); orig.apply(null, arguments); };
  });
  window.addEventListener('error', function(e){
    push('ERR', [e.message, e.filename+':'+e.lineno+':'+e.colno]);
  });
  window.addEventListener('unhandledrejection', function(e){
    push('REJ', [String(e.reason && (e.reason.stack||e.reason.message||e.reason))]);
  });
  // Drain when body is ready
  var iv = setInterval(function(){ if (document.body) { write(); clearInterval(iv); } }, 50);
  push('LOG', ['on-page console installed']);
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${cormorant.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="h-[100dvh] overflow-hidden flex flex-col bg-paper text-ink">
        <script dangerouslySetInnerHTML={{ __html: onPageConsole }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
