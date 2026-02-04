import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ironhand.operations",
  appName: "Iron Hand",
  webDir: "../.next",
  server: {
    url: "https://ironhand.net",
    cleartext: false,
    allowNavigation: ["ironhand.net", "*.ironhand.net"],
  },
  bundledWebRuntime: false,
};

export default config;
