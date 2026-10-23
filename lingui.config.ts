import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  locales: ["en", "fr", "de", "es", "ja", "ko", "pt", "ru", "zh"],
  sourceLocale: "en",
  fallbackLocales: { default: "en" },
  format: formatter({ origins: true, lineNumbers: false }),
  catalogs: [
    {
      path: "<rootDir>/src/i18n/locales/{locale}/messages",
      include: [
        "<rootDir>/src/app",
        "<rootDir>/src/components",
        "<rootDir>/src/i18n",
        "<rootDir>/src/main.tsx",
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx"],
    },
  ],
  compileNamespace: "json",
});
