import { Schema } from "effect";

export class AudioFrame extends Schema.TaggedClass<AudioFrame>()("AudioFrame", {
  samples: Schema.Uint8ArrayFromSelf,
  sampleRate: Schema.Number,
  channels: Schema.Number,
  timestamp: Schema.Number,
}) {}

export class AudioEncoding extends Schema.TaggedClass<AudioEncoding>()("AudioEncoding", {
  sampleRate: Schema.Literal(8000, 16000, 24000, 48000),
  channels: Schema.Literal(1, 2),
  format: Schema.Literal("pcm16", "mulaw", "alaw"),
}) {}
