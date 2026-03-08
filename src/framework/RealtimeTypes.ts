import type { Effect, Ref } from "effect";
import type { Queue } from "effect";
import type { AudioFrame } from "../schemas/AudioFrame.js";
import type { PipelineEvent } from "../schemas/Events.js";
import type { MessageSocket } from "../internal/MessageSocket.js";

/**
 * @name RealtimeAction
 * @description The actions that a provider emits from its message handler; dispatch to queues/effects.
 */
export type RealtimeAction =
  | { _tag: "AudioFrame"; frame: AudioFrame }
  | { _tag: "Event"; event: PipelineEvent }
  | { _tag: "SessionReady" }
  | { _tag: "Ignored" };

/**
 * @name RealtimeInterruptContext
 * @description The context that will be used to pass to onInterrupt so the provider can send cancel, clear queues, reset state.
 */
export interface RealtimeInterruptContext<State = unknown> {
  readonly socket: MessageSocket;
  readonly stateRef: Ref.Ref<State>;
  readonly setState: (s: State) => Effect.Effect<void>;
  readonly initialState: State;
  readonly audioQueue: Queue.Queue<AudioFrame>;
  readonly eventQueue: Queue.Queue<PipelineEvent>;
  readonly playedAudioMs?: number;
}

/**
 * @name RealtimeMessageContext
 * @description The context that will be used to pass to the realtime message context.
 */
export interface RealtimeMessageContext {
  readonly audioQueue: Queue.Queue<AudioFrame>;
}
