import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.tasknotes.app",
  appName: "TaskNotes",
  webDir: "dist",
  backgroundColor: "#fbfcfe",
  server: {
    hostname: "tasknotes.dev",
    androidScheme: "https",
    iosScheme: "https",
  },
  android: {
    backgroundColor: "#fbfcfe",
  },
};

export default config;
