import { Effect, Queue, Schema, Stream } from "effect";
import type { Scope } from "effect";
import type WebSocket from "ws";
import { ProviderError } from "@/core/Errors.js";

/**
 * Decode raw JSON at the provider message boundary. Use in adapters before passing to pure handlers.
 * Returns an Effect that succeeds with the decoded value or fails with Schema.SchemaError.
 */
export const decodeAtBoundary =
  <S extends Schema.Top>(
    schema: S,
  ): ((raw: unknown) => Effect.Effect<S["Type"], Schema.SchemaError, S["DecodingServices"]>) =>
  (raw) =>
    Schema.decodeUnknownEffect(schema)(raw);

export interface MessageSocket {
  readonly send: (msg: Record<string, unknown>) => Effect.Effect<void, ProviderError>;
  /** Raw JSON-parsed messages. Adapters must decode at boundary (e.g. Schema.decodeUnknown) before passing to pure handlers. */
  readonly inbound: Stream.Stream<unknown, ProviderError>;
}

/**
 * Create a scoped Effect resource that wraps a raw WebSocket for JSON message exchange.
 * Inbound messages are pushed to a queue and exposed as a Stream&lt;unknown&gt;; outbound is synchronous send.
 * The socket is closed when the enclosing scope finalizes.
 *
 * **Decode at boundary**: Consumers of `inbound` must decode each message with a provider-specific
 * Schema (e.g. Schema.decodeUnknown(OpenAIServerMessageSchema)(raw)) before passing to pure message
 * handlers. On decode failure, log and skip (or emit an operational event) per ARCHITECTURE Section 4.
 */
export const make = (
  ws: WebSocket,
  options?: { readonly provider?: string },
): Effect.Effect<MessageSocket, ProviderError, Scope.Scope> =>
  Effect.gen(function* () {
    const provider = options?.provider ?? "provider";
    const queue = yield* Queue.unbounded<unknown>();

    const send: MessageSocket["send"] = (msg) =>
      Effect.try({
        try: () => {
          if (ws.readyState !== ws.OPEN) {
            throw new Error("WebSocket is not open");
          }
          ws.send(JSON.stringify(msg));
        },
        catch: (cause) =>
          new ProviderError({
            provider,
            reason: "Failed to send message",
            cause,
          }),
      });

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Queue.shutdown(queue), () =>
        Effect.sync(() => {
          if (ws.readyState === ws.OPEN) ws.close();
        }),
      ),
    );

    ws.on("message", (raw: Buffer | string) => {
      try {
        const json = typeof raw === "string" ? raw : (raw as Buffer).toString("utf-8");
        const parsed = JSON.parse(json) as unknown;
        Effect.runSync(Queue.offer(queue, parsed));
      } catch {
        // malformed message; skip
      }
    });

    ws.on("close", () => {
      Effect.runSync(Queue.shutdown(queue));
    });

    ws.on("error", () => {
      Effect.runSync(Queue.shutdown(queue));
    });

    const inbound = Stream.fromQueue(queue).pipe(
      Stream.catch(() =>
        Stream.fail(
          new ProviderError({
            provider,
            reason: "Message stream closed",
          }),
        ),
      ),
    );

    return { send, inbound };
  });
