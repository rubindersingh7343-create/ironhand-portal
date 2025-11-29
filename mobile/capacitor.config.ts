import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ironhand.operations",
  appName: "Iron Hand Operations",
  webDir: "../.next",
  server: {
    url: "https://your-production-domain.com",
    cleartext: false,
  },
  bundledWebRuntime: false,
};

export default config;
