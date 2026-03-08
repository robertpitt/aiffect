import type { InputAudioFormat, OutputAudioFormat } from "./SessionConfig.js";

/**
 * @name ProviderCapabilities
 * @description The provider capabilities that will be used to negotiate the capabilities of the provider.
 */
export interface ProviderCapabilities {
  /**
   * @name acceptedInputFormats
   * @description The input audio formats that the provider accepts.
   */
  readonly acceptedInputFormats: ReadonlyArray<InputAudioFormat>;
  /**
   * @name outputFormat
   * @description The output audio format that the provider produces.
   */
  readonly outputFormat: OutputAudioFormat;

  /**
   * @name supportsNativeBargeIn
   * @description True if the provider handles barge-in/interrupt natively (pipeline may skip custom barge-in).
   */
  readonly supportsNativeBargeIn: boolean;

  /**
   * @name supportsToolCalling
   * @description True if the provider supports tool calling.
   */
  readonly supportsToolCalling: boolean;

  /**
   * @name turnDetection
   * @description The turn detection style that the provider supports.
   */
  readonly turnDetection: "server" | "client" | "none";
}

/**
 * @name defaultRealtimeCapabilities
 * @description The default realtime capabilities that will be used to negotiate the capabilities of the provider.
 */
export const defaultRealtimeCapabilities: ProviderCapabilities = {
  acceptedInputFormats: ["pcm16"],
  outputFormat: "pcm16",
  supportsNativeBargeIn: true,
  supportsToolCalling: true,
  turnDetection: "server",
};
