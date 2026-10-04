import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  locales: ["en", "fr"],
  sourceLocale: "en",
  fallbackLocales: { default: "en" },
  format: formatter({ origins: true, lineNumbers: false }),
  catalogs: [
    {
      path: "<rootDir>/src/i18n/locales/{locale}/messages",
      include: [
        "<rootDir>/src/app/collection-settings.tsx",
        "<rootDir>/src/i18n/pilot-fixture.tsx",
      ],
    },
  ],
  compileNamespace: "json",
});
