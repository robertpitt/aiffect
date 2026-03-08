/**
 * In-memory transport for tests: inject input frames via inbound queue, capture output frames from send().
 */

import { Effect, Layer, Queue, Stream } from "effect";
import { AudioFrame } from "../schemas/AudioFrame.js";
import { Transport } from "../framework/Transport.js";
import { TransportError } from "../framework/Errors.js";

export interface TestTransportHarness {
  readonly layer: Layer.Layer<Transport>;
  /** Queue to push frames into (transport's inbound stream reads from here). */
  readonly inboundQueue: Queue.Queue<AudioFrame>;
  /** Queue that receives frames when transport.send() is called. */
  readonly outboundQueue: Queue.Queue<AudioFrame>;
  /** Number of times clear() was called. */
  readonly clearCountRef: { current: number };
}

/**
 * Create a test transport. Push frames to inboundQueue to simulate client audio;
 * read from outboundQueue to assert on frames the pipeline sent. clearCountRef.current
 * is incremented each time clear() is called.
 */
export const makeTestTransport = (): Effect.Effect<TestTransportHarness> =>
  Effect.gen(function* () {
    const inboundQueue = yield* Queue.unbounded<AudioFrame>();
    const outboundQueue = yield* Queue.unbounded<AudioFrame>();
    const clearCountRef = { current: 0 };

    const layer = Layer.scoped(
      Transport,
      Effect.acquireRelease(
        Effect.sync(() => ({
          inbound: Stream.fromQueue(inboundQueue).pipe(
            Stream.catchAll(() =>
              Stream.fail(new TransportError({ reason: "TestTransport closed" })),
            ),
          ),
          send: (frame: AudioFrame) => Queue.offer(outboundQueue, frame),
          clear: Effect.sync(() => {
            clearCountRef.current += 1;
          }),
        })),
        () =>
          Effect.gen(function* () {
            yield* Queue.shutdown(inboundQueue);
            yield* Queue.shutdown(outboundQueue);
          }),
      ),
    );

    return { layer, inboundQueue, outboundQueue, clearCountRef };
  });
