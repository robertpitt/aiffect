import { Context, Effect, Schema, Stream } from "effect";
import type { AudioFrame } from "../schemas/AudioFrame.js";
import type { TranscriptDelta, PipelineEvent } from "../schemas/Events.js";
import type { ProviderError } from "./Errors.js";

/**
 * @name RealtimeConfig
 * @description The realtime config that will be used to configure the realtime provider.
 */
export class RealtimeConfig extends Schema.Class<RealtimeConfig>("RealtimeConfig")({
  model: Schema.String,
  voice: Schema.String,
  sampleRate: Schema.Literal(8000, 16000, 24000, 48000),
  channels: Schema.Literal(1, 2),
}) {}

/**
 * @name RealtimeShape
 * @description The realtime shape that will be used to shape the realtime provider.
 */
export interface RealtimeShape {
  /**
   * @name send
   * @description The function that will be used to send an audio frame to the realtime provider.
   */
  readonly send: (frame: AudioFrame) => Effect.Effect<void, ProviderError>;

  /**
   * @name receive
   * @description The function that will be used to receive an audio frame from the realtime provider.
   */
  readonly receive: Stream.Stream<AudioFrame, ProviderError>;

  /**
   * @name events
   * @description The function that will be used to receive an event from the realtime provider.
   */
  readonly events: Stream.Stream<PipelineEvent, ProviderError>;

  /**
   * @name interrupt
   * @description The function that will be used to interrupt the realtime provider.
   */
  readonly interrupt: (playedAudioMs?: number) => Effect.Effect<void, ProviderError>;

  /**
   * @name submitToolOutput
   * @description The function that will be used to submit tool output to the realtime provider.
   */
  readonly submitToolOutput: (
    callId: string,
    name: string,
    output: unknown,
  ) => Effect.Effect<void, ProviderError>;

  /**
   * @name requestResponse
   * @description The function that will be used to request the next model response from the realtime provider.
   */
  readonly requestResponse: () => Effect.Effect<void, ProviderError>;
}

/**
 * @name Realtime
 * @description The realtime context that will be used to run the realtime provider.
 */
export class Realtime extends Context.Tag("@aiffect/Realtime")<Realtime, RealtimeShape>() {}

/**
 * @name STTShape
 * @description The stt shape that will be used to shape the stt provider.
 */
export interface STTShape {
  readonly transcribe: <E>(
    audio: Stream.Stream<AudioFrame, E>,
  ) => Stream.Stream<TranscriptDelta, ProviderError | E>;
}

/**
 * @name STT
 * @description The stt context that will be used to run the stt provider.
 */
export class STT extends Context.Tag("@aiffect/STT")<STT, STTShape>() {}

/**
 * @name TTSShape
 * @description The tts shape that will be used to shape the tts provider.
 */
export interface TTSShape {
  readonly synthesize: (text: string) => Stream.Stream<AudioFrame, ProviderError>;
}

/**
 * @name TTS
 * @description The tts context that will be used to run the tts provider.
 */
export class TTS extends Context.Tag("@aiffect/TTS")<TTS, TTSShape>() {}
