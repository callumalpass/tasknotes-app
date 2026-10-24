import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";
import { initializeAppI18n } from "../i18n/app";

// Reset the real translator, not the user's persisted preference. Writing to
// jsdom Storage here schedules StorageEvents and pollutes fake-timer tests.
beforeEach(() => initializeAppI18n().activate("en"));

configure({ asyncUtilTimeout: 5_000 });
import "fake-indexeddb/auto";
