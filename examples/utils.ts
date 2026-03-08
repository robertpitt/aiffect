/**
 * Shared utilities for concierge examples.
 *
 * Exports static assets and server context used by concierge.openai.ts
 * and concierge.gemini.ts. Each example uses the default single agent (concierge).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SampleServerContextLive } from "../sample/agents/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const indexHtmlRaw = readFileSync(
  join(__dirname, "public", "index.html"),
  "utf-8",
);

/** Return index HTML with provider injected for voice selector. */
export const getIndexHtml = (provider: "openai" | "gemini") =>
  indexHtmlRaw.replace("__PROVIDER__", provider);

export const indexHtml = indexHtmlRaw;
export { SampleServerContextLive };
export const DEFAULT_PORT = Number(process.env["PORT"] ?? 8081);
