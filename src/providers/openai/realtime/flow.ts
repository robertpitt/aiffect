/**
 * OpenAI Realtime — connection, interrupt, and inbuilt flow (message loop → Realtime service).
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
import type { RealtimeAction, RealtimeInterruptContext } from "../../../framework/RealtimeTypes.js";
import { decodeAtBoundary, make as makeMessageSocket } from "../../../internal/MessageSocket.js";
import { serializeToolOutput } from "../../../internal/serializeToolOutput.js";
import { handleOpenAIMessage } from "./handler.js";
import { buildSessionUpdate } from "./session.js";
import { inputTokensCounter, outputTokensCounter } from "../../../observability/UsageMetrics.js";
import { OpenAIServerMessageSchema, OpenAIRealtimeOptions, OpenAIHandlerState } from "./schema.js";
import { OPENAI_REALTIME_URL, initialOpenAIHandlerState } from "./config.js";

const PROVIDER_NAME = "OpenAI";

function connect(options?: OpenAIRealtimeOptions): Effect.Effect<WebSocket, ProviderError, Agent> {
  return Effect.gen(function* () {
    const apiKey = yield* Config.redacted("OPENAI_API_KEY").pipe(
      Effect.mapError(
        (e) =>
          new ProviderError({
            provider: PROVIDER_NAME,
            reason: "Missing or invalid OPENAI_API_KEY",
            cause: e,
          }),
      ),
    );
    const model = options?.model ?? "gpt-4o-realtime-preview";
    return yield* Effect.async<WebSocket, ProviderError>((resume) => {
      const socket = new WS(`${OPENAI_REALTIME_URL}?model=${model}`, {
        headers: {
          Authorization: `Bearer ${Redacted.value(apiKey)}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });
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

function onInterrupt(
  ctx: RealtimeInterruptContext<OpenAIHandlerState>,
): Effect.Effect<void, ProviderError> {
  return Effect.gen(function* () {
    const state = yield* Ref.get(ctx.stateRef);
    if (state.currentResponseId != null) {
      yield* ctx.socket.send({ type: "response.cancel" });
    }
    if (state.currentItemId != null && ctx.playedAudioMs !== undefined) {
      yield* ctx.socket.send({
        type: "conversation.item.truncate",
        item_id: state.currentItemId,
        content_index: state.currentContentIndex,
        audio_end_ms: Math.round(ctx.playedAudioMs),
      });
    }
    yield* Queue.takeAll(ctx.audioQueue);
    yield* ctx.setState({
      ...initialOpenAIHandlerState,
      currentResponseId: null,
      currentItemId: null,
      responseAudioFrames: 0,
    });
    yield* Queue.offer(ctx.eventQueue, new Interrupted({ timestamp: Date.now() }));
  });
}

function runFlow(
  options?: OpenAIRealtimeOptions,
): Effect.Effect<Realtime["Type"], ProviderError, Scope.Scope | Agent> {
  return Effect.gen(function* () {
    const agent = yield* Agent;
    const ws: WebSocket = yield* connect(options).pipe(Effect.withSpan("openai.connect"));
    yield* Effect.log(`${PROVIDER_NAME} websocket connected`);

    const socket = yield* makeMessageSocket(ws, { provider: PROVIDER_NAME });
    const audioQueue = yield* Queue.unbounded<AudioFrame>();
    const eventQueue = yield* Queue.unbounded<PipelineEvent>();
    const stateRef = yield* Ref.make(initialOpenAIHandlerState);

    const agentContext: AgentContext = {
      sessionId: crypto.randomUUID(),
      metadata: {},
    };
    const sessionMsg = buildSessionUpdate(agent, agentContext, options);
    yield* socket.send(sessionMsg);
    yield* Effect.log(`${PROVIDER_NAME} session message sent`);

    if (options?.startWithResponseCreate === true) {
      yield* socket.send({ type: "response.create" });
      yield* Effect.log(`${PROVIDER_NAME} first response.create sent`);
    }

    const bufferInputUntilReady = options?.bufferInputUntilReady === true;
    const readyRef = yield* Ref.make(false);
    const inputBufferQueue = yield* Queue.unbounded<AudioFrame>();

    const appendAudio = (frame: AudioFrame) =>
      socket.send({
        type: "input_audio_buffer.append",
        audio:
          frame.samples instanceof Buffer
            ? frame.samples.toString("base64")
            : Buffer.from(frame.samples).toString("base64"),
      });

    const setState = (s: OpenAIHandlerState) => Ref.set(stateRef, s);
    const dispatch = (action: RealtimeAction) =>
      Effect.gen(function* () {
        switch (action._tag) {
          case "AudioFrame":
            yield* Queue.offer(audioQueue, action.frame);
            break;
          case "Event":
            yield* Queue.offer(eventQueue, action.event);
            break;
          case "SessionReady": {
            yield* Effect.log(`${PROVIDER_NAME} session ready`);
            if (bufferInputUntilReady) {
              yield* Ref.set(readyRef, true);
              const drain = Effect.forever(
                Queue.take(inputBufferQueue).pipe(Effect.flatMap((frame) => appendAudio(frame))),
              );
              yield* Effect.fork(drain);
            }
            break;
          }
          case "Ignored":
            break;
        }
      });

    const messageLoop = Stream.runForEach(socket.inbound, (raw) =>
      Effect.gen(function* () {
        const decoded = yield* decodeAtBoundary(OpenAIServerMessageSchema)(raw).pipe(
          Effect.tapError((e) =>
            Effect.log(`${PROVIDER_NAME} message decode failed`).pipe(
              Effect.annotateLogs("parseError", String(e)),
            ),
          ),
          Effect.option,
        );
        if (Option.isNone(decoded)) return;
        const msg = decoded.value;
        if (msg.type === "error") {
          yield* Effect.logError("openai server error").pipe(
            Effect.annotateLogs("error", JSON.stringify(msg.error)),
          );
          return;
        }
        const state = yield* Ref.get(stateRef);
        const { actions, nextState } = handleOpenAIMessage(msg, state);
        yield* setState(nextState);
        for (const a of actions) {
          yield* dispatch(a);
        }
        if (msg.type === "response.done" && msg.response?.usage) {
          const usage = msg.response.usage;
          yield* Effect.tagMetrics(
            "provider",
            "openai",
          )(inputTokensCounter(Effect.succeed(usage.input_tokens ?? 0)));
          yield* Effect.tagMetrics(
            "provider",
            "openai",
          )(outputTokensCounter(Effect.succeed(usage.output_tokens ?? 0)));
        }
      }),
    );

    yield* Effect.fork(messageLoop);

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Queue.shutdown(audioQueue);
        yield* Queue.shutdown(eventQueue);
        if (bufferInputUntilReady) {
          yield* Queue.shutdown(inputBufferQueue);
        }
        yield* Effect.sync(() => {
          if (ws.readyState === ws.OPEN) ws.close();
        });
      }),
    );

    const send: Realtime["Type"]["send"] = (frame) =>
      bufferInputUntilReady
        ? Ref.get(readyRef).pipe(
            Effect.flatMap((ready) =>
              ready ? appendAudio(frame) : Queue.offer(inputBufferQueue, frame).pipe(Effect.asVoid),
            ),
          )
        : appendAudio(frame);

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

    const interrupt: Realtime["Type"]["interrupt"] = (playedAudioMs) =>
      onInterrupt({
        socket,
        stateRef,
        setState: (s: OpenAIHandlerState) => Ref.set(stateRef, s),
        initialState: initialOpenAIHandlerState,
        audioQueue,
        eventQueue,
        playedAudioMs,
      }).pipe(Effect.tap(() => Effect.log(`${PROVIDER_NAME} interrupt`)));

    const submitToolOutput: Realtime["Type"]["submitToolOutput"] = (callId, name, output) =>
      Effect.gen(function* () {
        const outputStr = serializeToolOutput(output);
        yield* socket.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: outputStr,
          },
        });
        // Do not send response.create here; wait for response.done (see pipeline: requestResponse on ResponseCompleted).
      });

    const requestResponse: Realtime["Type"]["requestResponse"] = () =>
      socket.send({ type: "response.create" });

    return {
      send,
      receive,
      events,
      interrupt,
      submitToolOutput,
      requestResponse,
    };
  }).pipe(Effect.withSpan("openai.provider"));
}

/** Layer factory for OpenAI Realtime. */
export function make(
  options?: OpenAIRealtimeOptions,
): Layer.Layer<Realtime, ProviderError, Scope.Scope | Agent> {
  return Layer.scoped(Realtime, runFlow(options));
}
