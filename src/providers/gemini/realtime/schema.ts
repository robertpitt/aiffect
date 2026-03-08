/**
 * Gemini Live Realtime — schemas as single source of truth. Types derived via Schema.Type.
 */

import { Schema } from "effect";

const GeminiTranscription = Schema.Struct({ text: Schema.optional(Schema.String) });
const GeminiBlob = Schema.Struct({
  mimeType: Schema.optional(Schema.String),
  data: Schema.optional(Schema.String),
});
const GeminiPart = Schema.Struct({
  text: Schema.optional(Schema.String),
  inlineData: Schema.optional(GeminiBlob),
});
const GeminiContent = Schema.Struct({
  role: Schema.optional(Schema.String),
  parts: Schema.optional(Schema.Array(GeminiPart)),
});
export const GeminiServerContentSchema = Schema.Struct({
  generationComplete: Schema.optional(Schema.Boolean),
  turnComplete: Schema.optional(Schema.Boolean),
  interrupted: Schema.optional(Schema.Boolean),
  inputTranscription: Schema.optional(GeminiTranscription),
  outputTranscription: Schema.optional(GeminiTranscription),
  modelTurn: Schema.optional(GeminiContent),
});
const GeminiFunctionCall = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const GeminiToolCall = Schema.Struct({
  functionCalls: Schema.optional(Schema.Array(GeminiFunctionCall)),
});
const GeminiUsageMetadata = Schema.Struct({
  promptTokenCount: Schema.optional(Schema.Number),
  responseTokenCount: Schema.optional(Schema.Number),
  totalTokenCount: Schema.optional(Schema.Number),
});

export const GeminiServerMessageSchema = Schema.Struct({
  usageMetadata: Schema.optional(GeminiUsageMetadata),
  setupComplete: Schema.optional(Schema.Struct({})),
  serverContent: Schema.optional(GeminiServerContentSchema),
  toolCall: Schema.optional(GeminiToolCall),
});

export type GeminiServerMessage = Schema.Schema.Type<typeof GeminiServerMessageSchema>;
export type GeminiServerContent = Schema.Schema.Type<typeof GeminiServerContentSchema>;

export const GeminiRealtimeOptionsSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  voice: Schema.optional(Schema.String),
});
export type GeminiRealtimeOptions = Schema.Schema.Type<typeof GeminiRealtimeOptionsSchema>;

export const GeminiHandlerStateSchema = Schema.Struct({
  responseActive: Schema.Boolean,
  responseId: Schema.NullOr(Schema.String),
  audioFrameCount: Schema.Number,
  responseIndex: Schema.Number,
});
export type GeminiHandlerState = Schema.Schema.Type<typeof GeminiHandlerStateSchema>;

export const initialGeminiHandlerState: GeminiHandlerState = {
  responseActive: false,
  responseId: null,
  audioFrameCount: 0,
  responseIndex: 0,
};
