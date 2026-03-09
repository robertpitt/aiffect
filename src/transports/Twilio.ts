import { Effect, Layer, Queue, Ref, Stream } from "effect";
import type WebSocket from "ws";
import { AudioFrame } from "@/core/AudioFrame.js";
import { Transport } from "@/core/Transport.js";
import { TransportError } from "@/core/Errors.js";
import {
  twilioInboundToPipeline,
  pipelineToTwilioOutbound,
} from "@/internal/audioConversion.js";

const PIPELINE_SAMPLE_RATE = 24000;
const PIPELINE_CHANNELS = 1;

export interface TwilioTransportOptions {
  /** When set, use a bounded queue for inbound audio. Default unbounded. */
  readonly queueCapacity?: number;
}

interface TwilioMessage {
  event: string;
  streamSid?: string;
  media?: { payload?: string };
}

/**
 * Create a Transport layer from a Twilio Media Stream WebSocket.
 * Twilio sends μ-law 8 kHz audio; we convert to PCM16 24 kHz for the pipeline.
 * Outbound audio is converted back to μ-law 8 kHz for Twilio.
 *
 * Message format:
 * - Inbound: { event: "start", streamSid } then { event: "media", media: { payload: base64 } }
 * - Outbound: { event: "media", streamSid, media: { payload: base64 } }
 * - Clear: { event: "clear", streamSid }
 */
export const fromTwilioMediaStream = (
  ws: WebSocket,
  options?: TwilioTransportOptions,
): Layer.Layer<Transport> => {
  const capacity = options?.queueCapacity;

  return Layer.effect(Transport)(
    Effect.gen(function* () {
      const queue = yield* capacity != null && capacity > 0
        ? Queue.sliding<AudioFrame>(capacity)
        : Queue.unbounded<AudioFrame>();
      const streamSidRef = yield* Ref.make<string | undefined>(undefined);

      yield* Effect.annotateCurrentSpan("transport.type", "twilio");

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ws.on("message", (data: Buffer | string) => {
            try {
              const msg = JSON.parse(data.toString()) as TwilioMessage;
              if (msg.event === "start" && msg.streamSid) {
                Effect.runSync(Ref.set(streamSidRef, msg.streamSid));
                return;
              }
              if (msg.event === "media" && msg.media?.payload) {
                const ulaw = Buffer.from(msg.media.payload, "base64");
                const pcm = twilioInboundToPipeline(
                  ulaw instanceof Uint8Array ? ulaw : new Uint8Array(ulaw),
                );
                const frame = new AudioFrame({
                  samples: pcm,
                  sampleRate: PIPELINE_SAMPLE_RATE,
                  channels: PIPELINE_CHANNELS,
                  timestamp: Date.now(),
                });
                Effect.runSync(Queue.offer(queue, frame));
              }
              if (msg.event === "stop") {
                Effect.runSync(Queue.shutdown(queue));
              }
            } catch {
              Effect.runSync(Queue.shutdown(queue));
            }
          });

          ws.on("close", () => {
            Effect.runSync(Queue.shutdown(queue));
          });

          ws.on("error", () => {
            Effect.runSync(Queue.shutdown(queue));
          });
        }),
        () =>
          Effect.gen(function* () {
            yield* Queue.shutdown(queue);
            yield* Effect.sync(() => {
              if (ws.readyState === ws.OPEN) ws.close();
            });
          }),
      );

      const inbound = Stream.fromQueue(queue).pipe(
        Stream.catch(() =>
          Stream.fail(new TransportError({ reason: "Twilio stream closed" })),
        ),
      );

      const send = (frame: AudioFrame) =>
        Effect.gen(function* () {
          const sid = yield* Ref.get(streamSidRef);
          if (!sid) return;
          const ulaw = pipelineToTwilioOutbound(
            frame.samples instanceof Uint8Array ? frame.samples : new Uint8Array(frame.samples),
            frame.sampleRate,
          );
          const payload = Buffer.from(ulaw).toString("base64");
          yield* Effect.try({
            try: () =>
              ws.send(
                JSON.stringify({
                  event: "media",
                  streamSid: sid,
                  media: { payload },
                }),
              ),
            catch: (cause) =>
              new TransportError({
                reason: "Failed to send audio to Twilio",
                cause,
              }),
          });
        });

      const clear = Effect.gen(function* () {
        const sid = yield* Ref.get(streamSidRef);
        if (sid) {
          yield* Effect.try({
            try: () =>
              ws.send(JSON.stringify({ event: "clear", streamSid: sid })),
            catch: (cause) =>
              new TransportError({
                reason: "Failed to send clear to Twilio",
                cause,
              }),
          });
        }
      });

      return { inbound, send, clear };
    }).pipe(Effect.withSpan("transport.twilio.setup")),
  );
};

/** Alias for fromTwilioMediaStream. */
export const TwilioTransport = fromTwilioMediaStream;
