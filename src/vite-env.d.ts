/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BENCHMARK_TOOLS?: string;
  readonly VITE_MDBASE_CONNECT_URL?: string;
  readonly VITE_MDBASE_MANIFEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
