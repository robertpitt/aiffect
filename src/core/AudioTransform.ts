import { Context, Layer } from "effect";
import type { Stream } from "effect";
import type { AudioFrame } from "./AudioFrame.js";
import type { ProviderError } from "./Errors.js";

export type AudioTransform = <E>(
  stream: Stream.Stream<AudioFrame, E>,
) => Stream.Stream<AudioFrame, E | ProviderError>;

export interface RealtimeAudioConfigShape {
  readonly inputTransform: AudioTransform;
  readonly outputTransform: AudioTransform;
}

export const identityTransform: AudioTransform = (s) => s;

export const defaultRealtimeAudioConfig: RealtimeAudioConfigShape = {
  inputTransform: identityTransform,
  outputTransform: identityTransform,
};

export class RealtimeAudioConfig extends Context.Tag("@aiffect/RealtimeAudioConfig")<
  RealtimeAudioConfig,
  RealtimeAudioConfigShape
>() {}

export const RealtimeAudioConfigLive = Layer.succeed(
  RealtimeAudioConfig,
  defaultRealtimeAudioConfig,
);
