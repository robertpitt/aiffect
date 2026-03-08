/**
 * OpenAI Realtime — schemas as single source of truth. Types derived via Schema.Type.
 */

import { Schema } from "effect";

const SessionCreated = Schema.Struct({ type: Schema.Literal("session.created") });
const SessionUpdated = Schema.Struct({ type: Schema.Literal("session.updated") });
const ErrorTo = Schema.Struct({
  type: Schema.Literal("error"),
  error: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
const ErrorMessage = Schema.Struct({
  type: Schema.Literal("error"),
  error: Schema.optional(Schema.Unknown),
}).pipe(
  Schema.transform(ErrorTo, {
    decode: (fromA) => ({
      type: "error" as const,
      error: (fromA.error ?? {}) as Record<string, unknown>,
    }),
    encode: (_toI, toA): { type: "error"; error: Record<string, unknown> } => ({
      type: "error",
      error: toA.error,
    }),
  }),
);
const ResponseCreated = Schema.Struct({
  type: Schema.Literal("response.created"),
  response: Schema.optional(Schema.Struct({ id: Schema.optional(Schema.String) })),
});
const ResponseDone = Schema.Struct({
  type: Schema.Literal("response.done"),
  response: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      status: Schema.optional(Schema.String),
      usage: Schema.optional(
        Schema.Struct({
          input_tokens: Schema.optional(Schema.Number),
          output_tokens: Schema.optional(Schema.Number),
          total_tokens: Schema.optional(Schema.Number),
        }),
      ),
    }),
  ),
});
const ResponseAudioDelta = Schema.Struct({
  type: Schema.Literal("response.audio.delta"),
  delta: Schema.optional(Schema.String),
});
const ResponseAudioDone = Schema.Struct({ type: Schema.Literal("response.audio.done") });
const SpeechStartedMsg = Schema.Struct({
  type: Schema.Literal("input_audio_buffer.speech_started"),
});
const SpeechStoppedMsg = Schema.Struct({
  type: Schema.Literal("input_audio_buffer.speech_stopped"),
});
const ResponseTranscriptDelta = Schema.Struct({
  type: Schema.Literal("response.audio_transcript.delta"),
  delta: Schema.optional(Schema.String),
});
const ResponseTranscriptDone = Schema.Struct({
  type: Schema.Literal("response.audio_transcript.done"),
  transcript: Schema.optional(Schema.String),
});
const InputTranscriptionCompleted = Schema.Struct({
  type: Schema.Literal("conversation.item.input_audio_transcription.completed"),
  transcript: Schema.optional(Schema.String),
});
const FunctionCallArgumentsDone = Schema.Struct({
  type: Schema.Literal("response.function_call_arguments.done"),
  call_id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.String),
});
const OutputItemAdded = Schema.Struct({
  type: Schema.Literal("response.output_item.added"),
  item: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      type: Schema.optional(Schema.String),
      role: Schema.optional(Schema.String),
    }),
  ),
});
const BufferCommitted = Schema.Struct({
  type: Schema.Literal("input_audio_buffer.committed"),
});
const OutputItemDone = Schema.Struct({
  type: Schema.Literal("response.output_item.done"),
});
const ConversationItemCreated = Schema.Struct({
  type: Schema.Literal("conversation.item.created"),
  item: Schema.optional(Schema.Unknown),
});
const ConversationItemInputTranscriptionDelta = Schema.Struct({
  type: Schema.Literal("conversation.item.input_audio_transcription.delta"),
  delta: Schema.optional(Schema.String),
});
const ConversationItemTruncated = Schema.Struct({
  type: Schema.Literal("conversation.item.truncated"),
  item_id: Schema.optional(Schema.String),
});
const ResponseContentPartAdded = Schema.Struct({
  type: Schema.Literal("response.content_part.added"),
  part: Schema.optional(Schema.Unknown),
});
const ResponseContentPartDone = Schema.Struct({
  type: Schema.Literal("response.content_part.done"),
  part: Schema.optional(Schema.Unknown),
});
const RateLimitsUpdated = Schema.Struct({
  type: Schema.Literal("rate_limits.updated"),
  rate_limits: Schema.optional(Schema.Unknown),
});
const ResponseFunctionCallArgumentsDelta = Schema.Struct({
  type: Schema.Literal("response.function_call_arguments.delta"),
  call_id: Schema.optional(Schema.String),
  delta: Schema.optional(Schema.String),
});

export const OpenAIServerMessageSchema = Schema.Union(
  SessionCreated,
  SessionUpdated,
  ErrorMessage,
  ResponseCreated,
  ResponseDone,
  ResponseAudioDelta,
  ResponseAudioDone,
  SpeechStartedMsg,
  SpeechStoppedMsg,
  ResponseTranscriptDelta,
  ResponseTranscriptDone,
  InputTranscriptionCompleted,
  FunctionCallArgumentsDone,
  OutputItemAdded,
  BufferCommitted,
  OutputItemDone,
  ConversationItemCreated,
  ConversationItemInputTranscriptionDelta,
  ConversationItemTruncated,
  ResponseContentPartAdded,
  ResponseContentPartDone,
  RateLimitsUpdated,
  ResponseFunctionCallArgumentsDelta,
);

export type OpenAIServerMessage = Schema.Schema.Type<typeof OpenAIServerMessageSchema>;

const TurnDetectionSchema = Schema.Struct({
  threshold: Schema.optional(Schema.Number),
  prefixPaddingMs: Schema.optional(Schema.Number),
  silenceDurationMs: Schema.optional(Schema.Number),
  createResponse: Schema.optional(Schema.Boolean),
  interruptResponse: Schema.optional(Schema.Boolean),
});

export const OpenAIRealtimeOptionsSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  voice: Schema.optional(Schema.String),
  /** If true, send response.create after session.update to start the first turn. */
  startWithResponseCreate: Schema.optional(Schema.Boolean),
  /** If true, buffer inbound audio in a queue until session.updated (and startWithResponseCreate if set) before sending to the API. */
  bufferInputUntilReady: Schema.optional(Schema.Boolean),
  /** Input audio format (pcm16 or ulaw). */
  inputAudioFormat: Schema.optional(Schema.Literal("pcm16", "ulaw")),
  /** Output audio format (pcm16 or ulaw). */
  outputAudioFormat: Schema.optional(Schema.Literal("pcm16", "ulaw")),
  /** Turn detection settings. */
  turnDetection: Schema.optional(TurnDetectionSchema),
  /** Transcription model (e.g. whisper-1). */
  transcriptionModel: Schema.optional(Schema.String),
  /** Transcription language hint. */
  transcriptionLanguage: Schema.optional(Schema.String),
  /** Enable input noise reduction. */
  noiseReduction: Schema.optional(Schema.Boolean),
  /** Speech speed (e.g. 0.8–1.2). */
  speed: Schema.optional(Schema.Number),
});
export type OpenAIRealtimeOptions = Schema.Schema.Type<typeof OpenAIRealtimeOptionsSchema>;

export const OpenAIHandlerStateSchema = Schema.Struct({
  currentResponseId: Schema.NullOr(Schema.String),
  currentItemId: Schema.NullOr(Schema.String),
  currentContentIndex: Schema.Number,
  responseAudioFrames: Schema.Number,
});
export type OpenAIHandlerState = Schema.Schema.Type<typeof OpenAIHandlerStateSchema>;

export const initialOpenAIHandlerState: OpenAIHandlerState = {
  currentResponseId: null,
  currentItemId: null,
  currentContentIndex: 0,
  responseAudioFrames: 0,
};
