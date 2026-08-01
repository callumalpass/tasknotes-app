import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";

export const appPlatform = {
  isNative(): boolean {
    return Capacitor.isNativePlatform();
  },

  async closeAuthorizationBrowser(): Promise<void> {
    if (Capacitor.isNativePlatform())
      await Browser.close().catch(() => undefined);
  },

  async openExternalUrl(url: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },

  addUrlOpenListener(
    listener: (url: string) => void,
  ): Promise<PluginListenerHandle | null> {
    if (!Capacitor.isNativePlatform()) return Promise.resolve(null);
    return App.addListener("appUrlOpen", ({ url }) => listener(url));
  },

  async launchUrl(): Promise<string | undefined> {
    if (!Capacitor.isNativePlatform()) return;
    return (await App.getLaunchUrl())?.url;
  },
};
