/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly TERMINAL_BRIDGE_AUTH_TOKEN?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
