import { Effect, Layer, Queue, Stream } from "effect";
import type WebSocket from "ws";
import { AudioFrame } from "../schemas/AudioFrame.js";
import { Transport } from "../framework/Transport.js";
import { TransportError } from "../framework/Errors.js";

const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHANNELS = 1;

/** When queue is bounded and full: "drop-oldest" (sliding) or "drop-newest" (dropping). Default "drop-oldest". */
export type QueueDropStrategy = "drop-oldest" | "drop-newest";

export interface WebSocketTransportOptions {
  readonly sampleRate?: number;
  readonly channels?: number;
  /** Optional interval in ms to send a JSON ping to keep the connection alive. */
  readonly pingIntervalMs?: number;
  /** When set, use a bounded queue to avoid unbounded buffering. Recommended for production (e.g. 1024). */
  readonly queueCapacity?: number;
  /** When queueCapacity is set and queue is full: drop-oldest (sliding) or drop-newest (dropping). Default drop-oldest. */
  readonly queueDropStrategy?: QueueDropStrategy;
}

/**
 * Create a Transport layer from a raw WebSocket that carries PCM16 audio.
 * Pass options (e.g. sampleRate, channels from your AppConfig) or omit for defaults.
 * The WebSocket is closed when the enclosing scope finalizes.
 */
export const fromWebSocket = (
  ws: WebSocket,
  options?: WebSocketTransportOptions,
): Layer.Layer<Transport> => {
  const sampleRate = options?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channels = options?.channels ?? DEFAULT_CHANNELS;
  const pingIntervalMs = options?.pingIntervalMs;
  const capacity = options?.queueCapacity;
  const dropStrategy = options?.queueDropStrategy ?? "drop-oldest";

  return Layer.scoped(
    Transport,
    Effect.gen(function* () {
      const queue = yield* capacity != null && capacity > 0
        ? dropStrategy === "drop-newest"
          ? Queue.dropping<AudioFrame>(capacity)
          : Queue.sliding<AudioFrame>(capacity)
        : Queue.unbounded<AudioFrame>();
      let inCount = 0;
      let outCount = 0;
      let pingTimer: ReturnType<typeof setInterval> | undefined;

      yield* Effect.annotateCurrentSpan("transport.type", "websocket");
      yield* Effect.annotateCurrentSpan("transport.sampleRate", sampleRate);
      yield* Effect.annotateCurrentSpan("transport.channels", channels);
      yield* Effect.log("websocket transport created");

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ws.on("message", (data: Buffer) => {
            inCount++;
            // Use Buffer as-is when possible (Buffer extends Uint8Array) to avoid copy
            const frame = new AudioFrame({
              samples: data instanceof Uint8Array ? data : new Uint8Array(data),
              sampleRate,
              channels,
              timestamp: Date.now(),
            });
            Effect.runSync(Queue.offer(queue, frame));
          });

          ws.on("close", () => {
            Effect.runSync(Queue.shutdown(queue));
          });

          ws.on("error", () => {
            Effect.runSync(Queue.shutdown(queue));
          });

          if (pingIntervalMs != null && pingIntervalMs > 0) {
            pingTimer = setInterval(() => {
              if (ws.readyState === ws.OPEN) {
                try {
                  ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
                } catch {
                  // ignore
                }
              }
            }, pingIntervalMs);
          }
        }),
        () =>
          Effect.gen(function* () {
            if (pingTimer != null) clearInterval(pingTimer);
            yield* Effect.log(`transport closing (in=${inCount} out=${outCount})`);
            yield* Queue.shutdown(queue);
            yield* Effect.sync(() => {
              if (ws.readyState === ws.OPEN) ws.close();
            });
          }),
      );

      const inbound = Stream.fromQueue(queue).pipe(
        Stream.catchAll(() => Stream.fail(new TransportError({ reason: "WebSocket closed" }))),
      );

      const send = (frame: AudioFrame) =>
        Effect.try({
          try: () => {
            ws.send(frame.samples instanceof Buffer ? frame.samples : Buffer.from(frame.samples));
            outCount++;
          },
          catch: (cause) =>
            new TransportError({
              reason: "Failed to send audio frame",
              cause,
            }),
        });

      const clear = Effect.try({
        try: () => ws.send(JSON.stringify({ type: "clear" })),
        catch: (cause) => new TransportError({ reason: "Failed to send clear signal", cause }),
      }).pipe(Effect.tap(() => Effect.log("transport: clear sent to client")));

      return { inbound, send, clear };
    }).pipe(Effect.withSpan("transport.setup")),
  );
};
