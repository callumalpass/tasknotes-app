import "@testing-library/jest-dom/vitest";
import { act } from "@testing-library/react";
import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";
import { activateAppLocale } from "../i18n/app";

beforeEach(() => act(() => activateAppLocale("en")));

configure({ asyncUtilTimeout: 5_000 });
import "fake-indexeddb/auto";
