import type { AudioFrame } from "@/core/AudioFrame.js";
import type { PipelineEvent } from "@/core/Events.js";

/**
 * @name RealtimeAction
 * @description The actions that a provider emits from its message handler; dispatch to queues/effects.
 */
export type RealtimeAction =
  | { _tag: "AudioFrame"; frame: AudioFrame }
  | { _tag: "Event"; event: PipelineEvent }
  | { _tag: "SessionReady" }
  | { _tag: "ClearAudioQueue" }
  | { _tag: "Ignored" };
