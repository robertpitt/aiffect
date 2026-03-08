/**
 * Gemini Live Realtime provider.
 * Structure: realtime/types, schema, handler, session, flow — entry re-exports make + public types.
 * @see https://ai.google.dev/api/live
 */

export { make } from "./realtime/flow.js";
export type {
  GeminiRealtimeOptions,
  GeminiServerMessage,
  GeminiServerContent,
  GeminiHandlerState,
} from "./realtime/types.js";
export { initialGeminiHandlerState } from "./realtime/types.js";
