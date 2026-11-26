/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_POWERBI_CDAS_URL?: string;
  /** DSN público de Sentry (proyecto React). Sin él, no se reporta nada. */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
