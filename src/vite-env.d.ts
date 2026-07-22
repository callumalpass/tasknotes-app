/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BENCHMARK_TOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
