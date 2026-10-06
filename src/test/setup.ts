import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";
import { initializeAppI18n } from "../i18n/app";

beforeEach(() => initializeAppI18n("en"));

configure({ asyncUtilTimeout: 5_000 });
import "fake-indexeddb/auto";
