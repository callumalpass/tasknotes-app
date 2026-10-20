import { expect, it } from "vitest";
import {
  assertStagingSdk,
  stagingIosEnvironment,
} from "./build-staging-ios.mjs";

it("selects genuine staging and native registration without inheriting LAB/production URLs", () => {
  const env = stagingIosEnvironment({
    VITE_TASKNOTES_ENVIRONMENT: "production",
    VITE_TASKNOTES_LAB_ORIGIN: "https://lab.example.test",
    VITE_MDBASE_CONNECT_URL: "https://connect.mdbase.dev",
    VITE_TASKNOTES_EDITOR_ORIGIN: "https://editor.example.test",
  });
  expect(env.VITE_TASKNOTES_ENVIRONMENT).toBe("staging");
  expect(env.TASKNOTES_STAGING_IOS).toBe("1");
  expect(env.TASKNOTES_APP_URL).toBe("https://staging.tasknotes-app.pages.dev");
  expect(env.VITE_TASKNOTES_LAB_ORIGIN).toBe("");
  expect(env.VITE_MDBASE_CONNECT_URL).toBe(
    "https://connect-staging.mdbase.dev",
  );
});
it("does not invent an Editor destination when the owner has not supplied one", () => {
  expect(() => stagingIosEnvironment({})).toThrow("explicit staging Editor");
});
it("pins the unchanged authenticated-handoff archive bytes", () => {
  expect(() => assertStagingSdk()).not.toThrow();
});
