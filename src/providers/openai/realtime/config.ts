/**
 * OpenAI Realtime — constants and re-exports. Types are derived from schema (see schema.ts).
 */

export const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
export const SAMPLE_RATE = 24000;
export const CHANNELS = 1;

// export type { OpenAIServerMessage, OpenAIRealtimeOptions, OpenAIHandlerState } from "./schema.js";
export { initialOpenAIHandlerState } from "./schema.js";
