import { Capacitor } from "@capacitor/core";
import { InAppReview } from "@capacitor-community/in-app-review";

/** The OS store-review request (App Store or Google Play); absent on the web. */
export interface StoreReview {
  readonly available: boolean;
  /** Ask the OS; it decides whether anything is shown. */
  request(): Promise<void>;
}

export const nativeStoreReview: StoreReview = {
  get available() {
    return Capacitor.isNativePlatform();
  },
  request: () => InAppReview.requestReview(),
};
