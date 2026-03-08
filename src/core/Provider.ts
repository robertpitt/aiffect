import { Effect, ServiceMap, Stream } from "effect";
import type { AudioFrame } from "@/core/AudioFrame.js";
import type { TranscriptDelta, PipelineEvent } from "@/core/Events.js";
import type { ProviderError } from "@/core/Errors.js";

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

  /**
   * When false, the pipeline will not call requestResponse() after submitting tool output.
   * Use for providers (e.g. Gemini) that auto-continue. Default: true.
   */
  readonly requiresExplicitRequestResponse?: boolean;
}

/**
 * @name Realtime
 * @description The realtime context that will be used to run the realtime provider.
 */
export class Realtime extends ServiceMap.Service<Realtime, RealtimeShape>()("@aiffect/Realtime") {}

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
export class STT extends ServiceMap.Service<STT, STTShape>()("@aiffect/STT") {}

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
export class TTS extends ServiceMap.Service<TTS, TTSShape>()("@aiffect/TTS") {}
