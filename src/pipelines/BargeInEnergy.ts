/**
 * Energy-based barge-in for Sandwich pipelines.
 * Monitors inbound audio frames; when RMS energy exceeds the threshold for
 * N consecutive frames while the assistant is speaking, triggers interruption.
 */

import { Effect, Queue, Ref, Stream } from "effect";
import type { AudioFrame } from "@/core/AudioFrame.js";
import { Transport } from "@/core/Transport.js";
import { pcm16Rms } from "@/internal/audio.js";
import {
  type BargeInConfig,
  DEFAULT_ENERGY_THRESHOLD,
  DEFAULT_FRAME_THRESHOLD,
} from "@/pipelines/BargeInConfig.js";

export interface BargeInEnergyDeps {
  readonly transport: Transport["Service"];
  readonly audioQueue: Queue.Queue<AudioFrame>;
  readonly assistantSpeaking: Ref.Ref<boolean>;
  readonly speechFrameCount: Ref.Ref<number>;
  readonly currentTurnFiber: Ref.Ref<
    import("effect").Fiber.Fiber<void, unknown> | null
  >;
  readonly onInterrupt: Effect.Effect<void>;
}

/**
 * Creates the inbound monitor fiber that feeds audio to the queue and
 * triggers barge-in when energy exceeds threshold for N consecutive frames.
 */
export function createInboundMonitor(
  config: BargeInConfig | undefined,
  deps: BargeInEnergyDeps,
): Effect.Effect<void, import("@/core/Errors.js").TransportError> {
  const energyThreshold = config?.energyThreshold ?? DEFAULT_ENERGY_THRESHOLD;
  const frameThreshold = config?.frameThreshold ?? DEFAULT_FRAME_THRESHOLD;

  return deps.transport.inbound.pipe(
    Stream.mapEffect((frame) =>
      Effect.gen(function* () {
        yield* Queue.offer(deps.audioQueue, frame);

        const energy = pcm16Rms(frame.samples);
        if (energy > energyThreshold) {
          const count = yield* Ref.updateAndGet(
            deps.speechFrameCount,
            (n) => n + 1,
          );
          const speaking = yield* Ref.get(deps.assistantSpeaking);
          if (speaking && count >= frameThreshold) {
            yield* deps.onInterrupt;
          }
        } else {
          yield* Ref.set(deps.speechFrameCount, 0);
        }
      }),
    ),
    Stream.runDrain,
    Effect.ensuring(Queue.shutdown(deps.audioQueue)),
    Effect.withSpan("sandwich.inbound"),
  );
}
