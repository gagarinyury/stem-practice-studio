import type { CapacitorConfig } from "@capacitor/cli";

// Dev-time config: WKWebView pulls from the Next.js dev server on the Mac,
// so Fast Refresh works on a real iPhone over LAN. For a production build
// switch `webDir` to the static export and remove the `server` block.
const config: CapacitorConfig = {
  appId: "studio.stempractice.app",
  appName: "Stem Practice",
  webDir: "capacitor-shell",
  server: {
    // Tailscale IP of the Mac — works over tailnet whether iPhone is on the
    // same Wi-Fi, on cellular, or elsewhere. Local 192.168.x stops working
    // the moment iPhone Tailscale is on, since tailnet intercepts routing.
    url: "http://100.116.66.5:4323",
    cleartext: true,
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
    // Disable WKWebView's outer rubberband scroll so the page can't be
    // pulled. Inner overflow-y-auto containers still scroll normally.
    scrollEnabled: false,
  },
};

export default config;
