import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ironhand.operations",
  appName: "Iron Hand",
  webDir: "../.next",
  server: {
    url: "https://ironhand.net/auth/login",
    cleartext: false,
    allowNavigation: [
      "https://ironhand.net",
      "https://*.ironhand.net",
      "ironhand.net",
      "*.ironhand.net",
    ],
  },
  bundledWebRuntime: false,
};

export default config;
