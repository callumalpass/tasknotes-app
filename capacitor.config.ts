/// <reference types="@capacitor-firebase/messaging" />
/// <reference types="@capacitor/push-notifications" />

import type { CapacitorConfig } from "@capacitor/cli";

export const TASKNOTES_NATIVE_APPLICATION_ORIGIN = "https://app.tasknotes.dev";

const { existsSync } = process.getBuiltinModule("node:fs");
const nativeApplicationUrl = new URL(TASKNOTES_NATIVE_APPLICATION_ORIGIN);
const firebaseProjectConfigured = Boolean(
  process.env.TASKNOTES_FIREBASE_PROJECT_ID?.trim(),
);
const androidFirebaseConfigured =
  firebaseProjectConfigured && existsSync("android/app/google-services.json");
const iosFirebaseConfigured =
  firebaseProjectConfigured &&
  existsSync("ios/App/App/GoogleService-Info.plist");
const sharedNativePlugins = [
  "@capacitor/app",
  "@capacitor/browser",
  "@capacitor/haptics",
];

const config: CapacitorConfig = {
  appId: "dev.tasknotes.app",
  appName: "TaskNotes",
  webDir: "dist",
  backgroundColor: "#fbfcfe",
  server: {
    hostname: nativeApplicationUrl.hostname,
    androidScheme: nativeApplicationUrl.protocol.slice(0, -1),
    // WKWebView cannot handle bundled assets through HTTP(S) scheme handlers.
    // Grant identity is carried by the proof-scoped native authority transport.
    iosScheme: "capacitor",
  },
  android: {
    backgroundColor: "#fbfcfe",
    includePlugins: [
      ...sharedNativePlugins,
      ...(androidFirebaseConfigured ? ["@capacitor/push-notifications"] : []),
    ],
  },
  ios: {
    // Authority bridge options contain credentials and signed request payloads.
    loggingBehavior: "none",
    includePlugins: [
      ...sharedNativePlugins,
      ...(iosFirebaseConfigured ? ["@capacitor-firebase/messaging"] : []),
    ],
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["alert", "badge", "sound"],
    },
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
