import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";
import { activateAppLocale } from "../i18n/app";

// No UI is mounted between tests; avoid React act scheduling timers in pure tests.
beforeEach(() => activateAppLocale("en"));

configure({ asyncUtilTimeout: 5_000 });
import "fake-indexeddb/auto";
