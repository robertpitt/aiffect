/**
 * Gemini Live Realtime — connection, interrupt, and inbuilt flow (message loop → Realtime service).
 */

import { Config, Effect, Layer, Option, Queue, Redacted, Ref, Stream } from "effect";
import type { Scope } from "effect";
import type WebSocket from "ws";
import WS from "ws";
import type { AudioFrame } from "../../../schemas/AudioFrame.js";
import type { PipelineEvent } from "../../../schemas/Events.js";
import { Interrupted } from "../../../schemas/Events.js";
import type { AgentContext } from "../../../framework/Agent.js";
import { Agent } from "../../../framework/Agent.js";
import { ProviderError } from "../../../framework/Errors.js";
import { Realtime } from "../../../framework/Provider.js";
import type { RealtimeAction } from "../../../framework/RealtimeTypes.js";
import { decodeAtBoundary, make as makeMessageSocket } from "../../../internal/MessageSocket.js";
import { serializeToolOutput } from "../../../internal/serializeToolOutput.js";
import { handleGeminiMessage } from "./handler.js";
import { buildSessionSetup } from "./session.js";
import { inputTokensCounter, outputTokensCounter } from "../../../observability/UsageMetrics.js";
import { GeminiServerMessageSchema } from "./schema.js";
import {
  GEMINI_LIVE_WS_URL,
  GEMINI_AUDIO_MIME,
  initialGeminiHandlerState,
  type GeminiRealtimeOptions,
  type GeminiHandlerState,
} from "./types.js";

const PROVIDER_NAME = "Gemini";

function connect(options?: GeminiRealtimeOptions): Effect.Effect<WebSocket, ProviderError, Agent> {
  return Effect.gen(function* () {
    const apiKey = yield* Config.redacted("GEMINI_API_KEY").pipe(
      Effect.orElse(() => Config.redacted("GOOGLE_API_KEY")),
      Effect.mapError(
        (e) =>
          new ProviderError({
            provider: PROVIDER_NAME,
            reason: "Missing or invalid GEMINI_API_KEY / GOOGLE_API_KEY",
            cause: e,
          }),
      ),
    );
    yield* Agent;
    const url = `${GEMINI_LIVE_WS_URL}?key=${encodeURIComponent(Redacted.value(apiKey))}`;
    return yield* Effect.async<WebSocket, ProviderError>((resume) => {
      const socket = new WS(url);
      socket.on("open", () => resume(Effect.succeed(socket as unknown as WebSocket)));
      socket.on("error", (err) =>
        resume(
          Effect.fail(
            new ProviderError({
              provider: PROVIDER_NAME,
              reason: `WebSocket connection failed: ${err.message}`,
              cause: err,
            }),
          ),
        ),
      );
    });
  });
}

function onInterrupt(ctx: {
  audioQueue: Queue.Queue<AudioFrame>;
  eventQueue: Queue.Queue<PipelineEvent>;
}): Effect.Effect<void, ProviderError> {
  return Effect.gen(function* () {
    yield* Queue.takeAll(ctx.audioQueue);
    yield* Queue.offer(ctx.eventQueue, new Interrupted({ timestamp: Date.now() }));
  });
}

function runFlow(
  options?: GeminiRealtimeOptions,
): Effect.Effect<Realtime["Type"], ProviderError, Scope.Scope | Agent> {
  return Effect.gen(function* () {
    const agent = yield* Agent;
    const ws: WebSocket = yield* connect(options).pipe(Effect.withSpan("gemini.connect"));
    yield* Effect.log(`${PROVIDER_NAME} websocket connected`);

    const socket = yield* makeMessageSocket(ws, { provider: PROVIDER_NAME });
    const audioQueue = yield* Queue.unbounded<AudioFrame>();
    const eventQueue = yield* Queue.unbounded<PipelineEvent>();
    const stateRef = yield* Ref.make(initialGeminiHandlerState);

    const agentContext: AgentContext = {
      sessionId: crypto.randomUUID(),
      metadata: {},
    };
    const sessionMsg = { setup: buildSessionSetup(agent, agentContext, options) };
    yield* socket.send(sessionMsg);
    yield* Effect.log(`${PROVIDER_NAME} session message sent`);

    const setState = (s: GeminiHandlerState) => Ref.set(stateRef, s);
    const dispatch = (action: RealtimeAction) =>
      Effect.gen(function* () {
        switch (action._tag) {
          case "AudioFrame":
            yield* Queue.offer(audioQueue, action.frame);
            break;
          case "Event":
            yield* Queue.offer(eventQueue, action.event);
            break;
          case "SessionReady":
            yield* Effect.log(`${PROVIDER_NAME} session ready`);
            yield* socket.send({
              clientContent: {
                turns: { role: "user", parts: [{ text: "Say your greeting." }] },
                turnComplete: true,
              },
            });
            break;
          case "Ignored":
            break;
        }
      });

    const messageLoop = Stream.runForEach(socket.inbound, (raw) =>
      Effect.gen(function* () {
        const decoded = yield* decodeAtBoundary(GeminiServerMessageSchema)(raw).pipe(
          Effect.tapError((e) =>
            Effect.log(`${PROVIDER_NAME} message decode failed`).pipe(
              Effect.annotateLogs("parseError", String(e)),
            ),
          ),
          Effect.option,
        );
        if (Option.isNone(decoded)) return;
        const msg = decoded.value;
        const state = yield* Ref.get(stateRef);
        const { actions, nextState } = handleGeminiMessage(msg, state);
        yield* setState(nextState);
        for (const a of actions) {
          yield* dispatch(a);
        }
        if (msg.usageMetadata) {
          const u = msg.usageMetadata;
          yield* Effect.tagMetrics(
            "provider",
            "gemini",
          )(inputTokensCounter(Effect.succeed(u.promptTokenCount ?? 0)));
          yield* Effect.tagMetrics(
            "provider",
            "gemini",
          )(outputTokensCounter(Effect.succeed(u.responseTokenCount ?? 0)));
        }
        if (msg.serverContent?.interrupted === true) {
          yield* Queue.takeAll(audioQueue);
        }
      }),
    );

    yield* Effect.fork(messageLoop);

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Queue.shutdown(audioQueue);
        yield* Queue.shutdown(eventQueue);
        yield* Effect.sync(() => {
          if (ws.readyState === ws.OPEN) ws.close();
        });
      }),
    );

    const send: Realtime["Type"]["send"] = (frame) =>
      socket.send({
        realtimeInput: {
          audio: {
            mimeType: GEMINI_AUDIO_MIME,
            // Avoid Buffer.from copy when frame.samples is already a Buffer (Node Buffer extends Uint8Array)
            data:
              frame.samples instanceof Buffer
                ? frame.samples.toString("base64")
                : Buffer.from(frame.samples).toString("base64"),
          },
        },
      });

    const receive: Realtime["Type"]["receive"] = Stream.fromQueue(audioQueue).pipe(
      Stream.catchAll(() =>
        Stream.fail(new ProviderError({ provider: PROVIDER_NAME, reason: "Audio stream closed" })),
      ),
    );

    const events: Realtime["Type"]["events"] = Stream.fromQueue(eventQueue).pipe(
      Stream.catchAll(() =>
        Stream.fail(new ProviderError({ provider: PROVIDER_NAME, reason: "Event stream closed" })),
      ),
    );

    const interrupt: Realtime["Type"]["interrupt"] = () =>
      onInterrupt({ audioQueue, eventQueue }).pipe(
        Effect.tap(() => Effect.log(`${PROVIDER_NAME} interrupt`)),
      );

    const submitToolOutput: Realtime["Type"]["submitToolOutput"] = (callId, name, output) =>
      Effect.gen(function* () {
        const outputStr = serializeToolOutput(output);
        yield* socket.send({
          toolResponse: {
            functionResponses: [
              {
                id: callId,
                name,
                response: { result: outputStr },
              },
            ],
          },
        });
      });

    const requestResponse: Realtime["Type"]["requestResponse"] = () => Effect.void;

    return {
      send,
      receive,
      events,
      interrupt,
      submitToolOutput,
      requestResponse,
    };
  }).pipe(Effect.withSpan("gemini.provider"));
}

/** Layer factory for Gemini Realtime. */
export function make(
  options?: GeminiRealtimeOptions,
): Layer.Layer<Realtime, ProviderError, Scope.Scope | Agent> {
  return Layer.scoped(Realtime, runFlow(options));
}
