import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";
import { initializeAppI18n } from "../i18n/app";

// Reset the real translator, not the user's persisted preference. Writing to
// jsdom Storage here schedules StorageEvents and pollutes fake-timer tests.
beforeEach(() => initializeAppI18n().activate("en"));

configure({ asyncUtilTimeout: 5_000 });
import "fake-indexeddb/auto";

// jsdom has <dialog> but not its modal methods or Web Animations; the shared
// UI's Dialog (collection switcher, confirmations) opens through showModal()
// and waits for its closing animation.
if (typeof Element !== "undefined")
  Element.prototype.getAnimations ??= () => [];
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.show ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

// jsdom has no layout, and its Range cannot be measured at all. CodeMirror
// measures the text it draws, so a Range answers as an unlaid-out one would.
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= () =>
    Object.assign([], {
      item: () => null,
    }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
}
