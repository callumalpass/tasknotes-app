/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
/** Version plus the short build commit when the build knows it. */
declare const __APP_BUILD_REVISION__: string;

interface ImportMetaEnv {
  readonly VITE_BENCHMARK_TOOLS?: string;
  readonly VITE_TASKNOTES_EDITOR_ORIGIN?: string;
  readonly VITE_TASKNOTES_CALENDAR_ORIGIN?: string;
  readonly VITE_MDBASE_CONNECT_URL?: string;
  readonly VITE_MDBASE_MANIFEST_URL?: string;
  readonly VITE_MDBASE_FEEDBACK_URL?: string;
  readonly VITE_MDBASE_FEEDBACK_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
