import { Layer, ServiceMap } from "effect";
import type { Stream } from "effect";
import type { AudioFrame } from "@/core/AudioFrame.js";
import type { ProviderError } from "@/core/Errors.js";

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

export class RealtimeAudioConfig extends ServiceMap.Service<
  RealtimeAudioConfig,
  RealtimeAudioConfigShape
>()("@aiffect/RealtimeAudioConfig") {}

export const RealtimeAudioConfigLive = Layer.succeed(
  RealtimeAudioConfig,
  defaultRealtimeAudioConfig,
);
