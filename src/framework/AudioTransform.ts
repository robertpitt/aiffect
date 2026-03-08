import { Context, Layer } from "effect";
import type { Stream } from "effect";
import type { AudioFrame } from "../schemas/AudioFrame.js";
import type { ProviderError } from "./Errors.js";

/**
 * @name AudioTransform
 * @description The function that will be used to transform a stream of audio frames.
 */
export type AudioTransform = <E>(
  stream: Stream.Stream<AudioFrame, E>,
) => Stream.Stream<AudioFrame, E | ProviderError>;

/**
 * @name RealtimeAudioConfig
 * @description The realtime audio config that will be used to transform the audio frames.
 */
export interface RealtimeAudioConfig {
  /**
   * @name inputTransform
   * @description The function that will be used to transform the input audio frames.
   */
  readonly inputTransform: AudioTransform;
  /**
   * @name outputTransform
   * @description The function that will be used to transform the output audio frames.
   */
  readonly outputTransform: AudioTransform;
}

/**
 * @name identityTransform
 * @description The identity transform that will be used to transform the audio frames.
 */
export const identityTransform: AudioTransform = (s) => s;

/**
 * @name defaultRealtimeAudioConfig
 * @description The default realtime audio config that will passthrough the audio frames.
 */
export const defaultRealtimeAudioConfig: RealtimeAudioConfig = {
  inputTransform: identityTransform,
  outputTransform: identityTransform,
};

/**
 * @name RealtimeAudioConfigTag
 * @description The realtime audio config tag that will be used to tag the realtime audio config.
 */
export class RealtimeAudioConfigTag extends Context.Tag("@aiffect/RealtimeAudioConfig")<
  RealtimeAudioConfigTag,
  RealtimeAudioConfig
>() {}

/**
 * @name defaultRealtimeAudioConfigLayer
 * @description The default realtime audio config layer that will passthrough the audio frames.
 */
export const defaultRealtimeAudioConfigLayer = Layer.succeed(
  RealtimeAudioConfigTag,
  defaultRealtimeAudioConfig,
);
