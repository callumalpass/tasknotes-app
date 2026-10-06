import { createElement, type ReactElement } from "react";
import { I18nProvider } from "@lingui/react";
import {
  render as testingLibraryRender,
  type RenderOptions,
} from "@testing-library/react";
import { initializeAppI18n } from "../i18n/app";

export * from "@testing-library/react";

/** Exercise real Lingui context without changing existing repository/test wrappers. */
export function render(ui: ReactElement, options: RenderOptions = {}) {
  const i18n = initializeAppI18n();
  const Wrapper = options.wrapper;
  return testingLibraryRender(ui, {
    ...options,
    wrapper: ({ children }) =>
      createElement(
        I18nProvider,
        { i18n },
        Wrapper ? createElement(Wrapper, null, children) : children,
      ),
  });
}
