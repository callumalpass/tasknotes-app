import { i18nConfig } from "@mdbase-dev/i18n/config";

export default i18nConfig({
  include: [
    "<rootDir>/src/app",
    "<rootDir>/src/components",
    "<rootDir>/src/i18n",
    "<rootDir>/src/main.tsx",
  ],
  exclude: ["**/*.test.ts", "**/*.test.tsx"],
});
