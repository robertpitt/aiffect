import { Effect, Ref } from "effect";
import type { PipelineEvent } from "@/core/Events.js";
import { Realtime } from "@/core/Provider.js";
import { Transport } from "@/core/Transport.js";

export interface BargeInState {
  readonly onEvent: (event: PipelineEvent) => Effect.Effect<void>;
  readonly isGated: Effect.Effect<boolean>;
  readonly trackPlayback: (frameDurationMs: number) => Effect.Effect<void>;
}

/**
 * Creates a Ref-based barge-in state machine. The outbound fiber should check
 * `isGated` before forwarding frames and call `trackPlayback` for each frame sent.
 * The event fiber should call `onEvent` for every provider event so state stays
 * in sync and barge-in is triggered when the user speaks over the assistant.
 */
export const make: Effect.Effect<BargeInState, never, Realtime | Transport> = Effect.gen(
  function* () {
    const realtime = yield* Realtime;
    const transport = yield* Transport;

    const isInterrupted = yield* Ref.make(false);
    const assistantSpeaking = yield* Ref.make(false);
    const playedAudioMs = yield* Ref.make(0);

    const isGated = Ref.get(isInterrupted);

    const trackPlayback = (frameDurationMs: number) =>
      Ref.update(playedAudioMs, (ms) => ms + frameDurationMs);

    const handleBargeIn = Effect.gen(function* () {
      const played = yield* Ref.get(playedAudioMs);
      yield* Ref.set(isInterrupted, true);
      yield* Ref.set(assistantSpeaking, false);
      yield* realtime.interrupt(played);
      if (transport.clear) {
        yield* transport.clear;
      }
      yield* Ref.set(playedAudioMs, 0);
      yield* Effect.log("barge-in triggered").pipe(
        Effect.annotateLogs("playedAudioMs", Math.round(played)),
      );
    }).pipe(
      Effect.withSpan("pipeline.bargeIn"),
      Effect.catch((cause) =>
        Effect.logError("barge-in failed").pipe(Effect.annotateLogs("error", String(cause))),
      ),
    );

    const onEvent = (event: PipelineEvent) =>
      Effect.gen(function* () {
        switch (event._tag) {
          case "AudioOutputStarted":
            yield* Ref.set(assistantSpeaking, true);
            yield* Ref.set(isInterrupted, false);
            yield* Ref.set(playedAudioMs, 0);
            break;

          case "AudioOutputDone":
          case "ResponseCompleted":
            yield* Ref.set(assistantSpeaking, false);
            break;

          case "Interrupted":
            yield* Ref.set(isInterrupted, true);
            yield* Ref.set(assistantSpeaking, false);
            yield* Ref.set(playedAudioMs, 0);
            break;

          case "SpeechStarted": {
            const speaking = yield* Ref.get(assistantSpeaking);
            if (speaking) {
              yield* handleBargeIn;
            }
            break;
          }

          default:
            break;
        }
      });

    return {
      onEvent,
      isGated,
      trackPlayback,
    };
  },
);
