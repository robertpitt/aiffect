import { Schema } from "effect";

export class AudioFrame extends Schema.TaggedClass<AudioFrame>()("AudioFrame", {
  samples: Schema.Uint8ArrayFromSelf,
  sampleRate: Schema.Number,
  channels: Schema.Number,
  timestamp: Schema.Number,
}) {}
