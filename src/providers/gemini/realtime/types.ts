/**
 * Gemini Live Realtime — constants and re-exports. Types are derived from schema (see schema.ts).
 */

export const GEMINI_LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
export const GEMINI_AUDIO_MIME = "audio/pcm;rate=24000";
export const DEFAULT_SAMPLE_RATE = 24000;
export const CHANNELS = 1;
export const DEFAULT_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export type {
  GeminiServerMessage,
  GeminiServerContent,
  GeminiRealtimeOptions,
  GeminiHandlerState,
} from "./schema.js";
export { initialGeminiHandlerState } from "./schema.js";
