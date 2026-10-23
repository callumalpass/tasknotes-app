import { createElement, type ReactElement } from "react";
import { AppI18nProvider } from "../i18n/app-provider";
import {
  render as testingLibraryRender,
  type RenderOptions,
} from "@testing-library/react";

export * from "@testing-library/react";

/** Exercise real Lingui context without changing existing repository/test wrappers. */
export function render(ui: ReactElement, options: RenderOptions = {}) {
  const Wrapper = options.wrapper;
  return testingLibraryRender(ui, {
    ...options,
    wrapper: ({ children }) =>
      createElement(
        AppI18nProvider,
        null,
        Wrapper ? createElement(Wrapper, null, children) : children,
      ),
  });
}
