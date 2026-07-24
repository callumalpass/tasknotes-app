/// <reference types="@capacitor-firebase/messaging" />

import type { CapacitorConfig } from "@capacitor/cli";

const { existsSync } = process.getBuiltinModule("node:fs");
const firebaseProjectConfigured = Boolean(
  process.env.TASKNOTES_FIREBASE_PROJECT_ID?.trim(),
);
const androidFirebaseConfigured =
  firebaseProjectConfigured && existsSync("android/app/google-services.json");
const iosFirebaseConfigured =
  firebaseProjectConfigured &&
  existsSync("ios/App/App/GoogleService-Info.plist");
const nativePlugins = (firebaseConfigured: boolean) => [
  "@capacitor/app",
  "@capacitor/browser",
  "@capacitor/filesystem",
  "@capacitor/haptics",
  "@capacitor/local-notifications",
  ...(firebaseConfigured ? ["@capacitor-firebase/messaging"] : []),
];

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
    includePlugins: nativePlugins(androidFirebaseConfigured),
  },
  ios: {
    includePlugins: nativePlugins(iosFirebaseConfigured),
  },
  plugins: {
    FirebaseMessaging: {
      presentationOptions: ["alert", "badge", "sound"],
    },
  },
  ...(iosFirebaseConfigured
    ? {
        experimental: {
          ios: {
            spm: {
              packageOptions: {
                "@capacitor-firebase/messaging": {
                  symlink: true,
                },
              },
            },
          },
        },
      }
    : {}),
};

export default config;
