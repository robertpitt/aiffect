import { Schema } from "effect";

export class TranscriptDelta extends Schema.TaggedClass<TranscriptDelta>()("TranscriptDelta", {
  role: Schema.Literal("user", "assistant"),
  text: Schema.String,
  isFinal: Schema.Boolean,
}) {}

export class SpeechStarted extends Schema.TaggedClass<SpeechStarted>()("SpeechStarted", {
  timestamp: Schema.Number,
}) {}

export class SpeechEnded extends Schema.TaggedClass<SpeechEnded>()("SpeechEnded", {
  timestamp: Schema.Number,
}) {}

export class Interrupted extends Schema.TaggedClass<Interrupted>()("Interrupted", {
  timestamp: Schema.Number,
}) {}

export class ToolCallStarted extends Schema.TaggedClass<ToolCallStarted>()("ToolCallStarted", {
  callId: Schema.String,
  name: Schema.String,
  arguments: Schema.String,
}) {}

/** Structured error for tool failure (typed failure model; see ADR 002). */
export class ToolCallError extends Schema.TaggedClass<ToolCallError>()("ToolCallError", {
  reason: Schema.String,
  code: Schema.optional(Schema.String),
}) {}

export class ToolCallCompleted extends Schema.TaggedClass<ToolCallCompleted>()(
  "ToolCallCompleted",
  {
    callId: Schema.String,
    name: Schema.String,
    /** Discriminant: success vs failure. Use `error` when status === "failure". */
    status: Schema.Literal("success", "failure"),
    /** Present when status === "success". */
    result: Schema.optional(Schema.Unknown),
    /** Present when status === "failure". */
    error: Schema.optional(ToolCallError),
  },
) {}

export class ResponseStarted extends Schema.TaggedClass<ResponseStarted>()("ResponseStarted", {
  responseId: Schema.String,
  timestamp: Schema.Number,
}) {}

export class ResponseCompleted extends Schema.TaggedClass<ResponseCompleted>()(
  "ResponseCompleted",
  {
    responseId: Schema.String,
    timestamp: Schema.Number,
    status: Schema.String,
    inputTokens: Schema.optionalWith(Schema.Number, { default: () => 0 }),
    outputTokens: Schema.optionalWith(Schema.Number, { default: () => 0 }),
    audioFrames: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  },
) {}

export class AudioOutputStarted extends Schema.TaggedClass<AudioOutputStarted>()(
  "AudioOutputStarted",
  {
    responseId: Schema.String,
    timestamp: Schema.Number,
  },
) {}

export class AudioOutputDone extends Schema.TaggedClass<AudioOutputDone>()("AudioOutputDone", {
  responseId: Schema.String,
  timestamp: Schema.Number,
  frames: Schema.Number,
}) {}

export type PipelineEvent =
  | TranscriptDelta
  | SpeechStarted
  | SpeechEnded
  | Interrupted
  | ToolCallStarted
  | ToolCallCompleted
  | ResponseStarted
  | ResponseCompleted
  | AudioOutputStarted
  | AudioOutputDone;

