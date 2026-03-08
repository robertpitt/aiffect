/**
 * In-memory Realtime provider for tests: control receive stream and events stream;
 * capture frames sent via send().
 */

import { Effect, Layer, Queue, Stream } from "effect";
import { AudioFrame } from "../core/AudioFrame.js";
import { Realtime } from "../core/Provider.js";
import { ProviderError } from "../core/Errors.js";
import type { PipelineEvent } from "../core/Events.js";

export interface TestRealtimeHarness {
  readonly layer: Layer.Layer<Realtime>;
  /** Push a frame to the provider's receive stream (outbound to transport). */
  readonly pushReceiveFrame: (frame: AudioFrame) => Effect.Effect<void>;
  /** Push an event to the provider's events stream. */
  readonly pushEvent: (event: PipelineEvent) => Effect.Effect<void>;
  /** Frames that were sent to the provider via send(). */
  readonly getSentFrames: Effect.Effect<readonly AudioFrame[]>;
  /** Shutdown the provider's queues (e.g. to end the session). */
  readonly shutdown: Effect.Effect<void>;
}

/**
 * Create a test Realtime provider. Use pushReceiveFrame and pushEvent to drive
 * the pipeline; use getSentFrames to assert on audio sent to the "provider".
 */
export const makeTestRealtime = (): Effect.Effect<TestRealtimeHarness> =>
  Effect.gen(function* () {
    const sentFramesRef = { current: [] as AudioFrame[] };
    const receiveQueue = yield* Queue.unbounded<AudioFrame>();
    const eventsQueue = yield* Queue.unbounded<PipelineEvent>();

    const layer = Layer.scoped(
      Realtime,
      Effect.acquireRelease(
        Effect.sync(() => ({
          send: (frame: AudioFrame) =>
            Effect.sync(() => {
              sentFramesRef.current = [...sentFramesRef.current, frame];
            }),
          receive: Stream.fromQueue(receiveQueue).pipe(
            Stream.catchAll(() =>
              Stream.fail(
                new ProviderError({ provider: "TestRealtime", reason: "receive closed" }),
              ),
            ),
          ),
          events: Stream.fromQueue(eventsQueue).pipe(
            Stream.catchAll(() =>
              Stream.fail(new ProviderError({ provider: "TestRealtime", reason: "events closed" })),
            ),
          ),
          interrupt: () => Effect.void,
          submitToolOutput: () => Effect.void,
          requestResponse: () => Effect.void,
        })),
        () =>
          Effect.gen(function* () {
            yield* Queue.shutdown(receiveQueue);
            yield* Queue.shutdown(eventsQueue);
          }),
      ),
    );

    return {
      layer,
      pushReceiveFrame: (frame: AudioFrame) => Queue.offer(receiveQueue, frame),
      pushEvent: (event: PipelineEvent) => Queue.offer(eventsQueue, event),
      getSentFrames: Effect.sync(() => sentFramesRef.current),
      shutdown: Queue.shutdown(receiveQueue).pipe(
        Effect.flatMap(() => Queue.shutdown(eventsQueue)),
      ),
    };
  });
