import { defineConfig } from "vitest/config";

// The default getCaller trusts x-user-address only with AUTH_DEV_HEADER=true (PG semantics); tests use the header.
export default defineConfig({ test: { env: { AUTH_DEV_HEADER: "true" } } });
