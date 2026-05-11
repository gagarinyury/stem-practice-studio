import type { CapacitorConfig } from "@capacitor/cli";

// Dev-time config: WKWebView pulls from the Next.js dev server on the Mac,
// so Fast Refresh works on a real iPhone over LAN. For a production build
// switch `webDir` to the static export and remove the `server` block.
const config: CapacitorConfig = {
  appId: "studio.stempractice.app",
  appName: "Stem Practice",
  webDir: "capacitor-shell",
  server: {
    url: "http://192.168.1.15:4323",
    cleartext: true,
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
