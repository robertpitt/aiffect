/**
 * Shared realtime kernel.
 * Providers implement RealtimeAdapter; the kernel handles queue management,
 * message loop, dispatch, finalization, and Realtime shape construction.
 */

import { Effect, Layer, Option, Queue, Ref, Stream } from "effect";
import type { Schema, Scope } from "effect";
import type { AudioFrame } from "../core/AudioFrame.js";
import type { PipelineEvent } from "../core/Events.js";
import type { AgentContext, AgentSpec } from "../core/Agent.js";
import { Agent } from "../core/Agent.js";
import { ProviderError } from "../core/Errors.js";
import { Realtime } from "../core/Provider.js";
import type { RealtimeAction } from "../core/RealtimeTypes.js";
import { SessionContext, makeSessionContext } from "../core/SessionContext.js";
import { decodeAtBoundary, type MessageSocket } from "../internal/MessageSocket.js";

export type { MessageSocket } from "../internal/MessageSocket.js";

/** Default no-op for onSessionReady. Adapters override when needed. */
export const defaultOnSessionReady = (): Effect.Effect<void, ProviderError> =>
  Effect.void;

/** Default for encodeRequestResponse. Returns null (no-op). Adapters override when needed. */
export const defaultEncodeRequestResponse = (): Record<string, unknown> | null =>
  null;

export interface KernelInterruptCtx<State> {
  readonly socket: MessageSocket;
  readonly stateRef: Ref.Ref<State>;
  readonly audioQueue: Queue.Queue<AudioFrame>;
  readonly eventQueue: Queue.Queue<PipelineEvent>;
  readonly playedAudioMs?: number;
}

export interface RealtimeAdapter<Msg, State> {
  readonly name: string;
  readonly initialState: State;
  readonly schema: Schema.Schema<Msg, any, never>;

  /**
   * Establish a connection and return a MessageSocket for JSON message exchange.
   * The transport mechanism (WebSocket, HTTP/SSE, gRPC, etc.) is the adapter's
   * responsibility. The returned MessageSocket must be scoped to the caller's scope.
   */
  readonly connect: (
    agent: AgentSpec,
    ctx: AgentContext,
  ) => Effect.Effect<MessageSocket, ProviderError, Scope.Scope>;

  /** Pure message handler: decoded message + state -> actions + next state. */
  readonly handler: (
    msg: Msg,
    state: State,
  ) => { actions: RealtimeAction[]; nextState: State };

  /** Called when the handler emits SessionReady (e.g. send a greeting or first response). */
  readonly onSessionReady?: (
    socket: MessageSocket,
  ) => Effect.Effect<void, ProviderError>;

  /** Provider-specific interrupt protocol. */
  readonly onInterrupt: (
    ctx: KernelInterruptCtx<State>,
  ) => Effect.Effect<void, ProviderError>;

  /** Encode an audio frame into the provider's wire format. */
  readonly encodeSend: (frame: AudioFrame) => Record<string, unknown>;

  /** Encode a tool output submission into the provider's wire format. */
  readonly encodeToolOutput: (
    callId: string,
    name: string,
    output: unknown,
  ) => Record<string, unknown>;

  /** Encode a request-response message, or return null for providers that don't support it. */
  readonly encodeRequestResponse?: () => Record<string, unknown> | null;

  /**
   * When false, the pipeline will not call requestResponse() after submitting tool output.
   * Use for providers (e.g. Gemini) that auto-continue. Default: true when encodeRequestResponse
   * returns a message, else false.
   */
  readonly requiresExplicitRequestResponse?: boolean;

  /** When true, buffer send() calls until SessionReady is dispatched. */
  readonly bufferSendUntilReady?: boolean;
}

function makeRealtimeFromAdapter<Msg, State>(
  adapter: RealtimeAdapter<Msg, State>,
): Effect.Effect<Realtime["Type"], ProviderError, Scope.Scope | Agent | SessionContext> {
  return Effect.gen(function* () {
    const agent = yield* Agent;
    const { sessionId } = yield* SessionContext;
    const agentContext: AgentContext = {
      sessionId,
      metadata: {},
    };

    const socket = yield* adapter
      .connect(agent, agentContext)
      .pipe(Effect.withSpan(`${adapter.name.toLowerCase()}.connect`));
    yield* Effect.log(`${adapter.name} connected`);

    const audioQueue = yield* Queue.unbounded<AudioFrame>();
    const eventQueue = yield* Queue.unbounded<PipelineEvent>();
    const stateRef = yield* Ref.make(adapter.initialState);

    const readyRef = yield* Ref.make(!adapter.bufferSendUntilReady);
    const sendBuffer = adapter.bufferSendUntilReady
      ? yield* Queue.unbounded<AudioFrame>()
      : undefined;

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
            yield* Effect.log(`${adapter.name} session ready`);
            if (adapter.onSessionReady) {
              yield* adapter.onSessionReady(socket);
            }
            if (sendBuffer) {
              yield* Ref.set(readyRef, true);
              yield* Effect.fork(
                Stream.fromQueue(sendBuffer).pipe(
                  Stream.catchAll(() => Stream.empty),
                  Stream.mapEffect((frame) =>
                    socket.send(adapter.encodeSend(frame)),
                  ),
                  Stream.runDrain,
                ),
              );
            }
            break;
          }
          case "ClearAudioQueue":
            yield* Queue.takeAll(audioQueue);
            break;
          case "Ignored":
            break;
        }
      });

    const messageLoop = Stream.runForEach(socket.inbound, (raw) =>
      Effect.gen(function* () {
        const decoded = yield* decodeAtBoundary(adapter.schema)(raw).pipe(
          Effect.tapError((e) =>
            Effect.log(`${adapter.name} message decode failed`).pipe(
              Effect.annotateLogs("parseError", String(e)),
            ),
          ),
          Effect.option,
        );
        if (Option.isNone(decoded)) return;
        const msg = decoded.value;
        const state = yield* Ref.get(stateRef);
        const { actions, nextState } = adapter.handler(msg, state);
        yield* Ref.set(stateRef, nextState);
        for (const a of actions) {
          yield* dispatch(a);
        }
      }),
    );

    yield* Effect.fork(messageLoop);

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Queue.shutdown(audioQueue);
        yield* Queue.shutdown(eventQueue);
        if (sendBuffer) yield* Queue.shutdown(sendBuffer);
      }),
    );

    const send: Realtime["Type"]["send"] = adapter.bufferSendUntilReady
      ? (frame) =>
          Ref.get(readyRef).pipe(
            Effect.flatMap((ready) =>
              ready
                ? socket.send(adapter.encodeSend(frame))
                : Queue.offer(sendBuffer!, frame).pipe(Effect.asVoid),
            ),
          )
      : (frame) => socket.send(adapter.encodeSend(frame));

    const receive: Realtime["Type"]["receive"] = Stream.fromQueue(audioQueue).pipe(
      Stream.catchAll(() =>
        Stream.fail(
          new ProviderError({
            provider: adapter.name,
            reason: "Audio stream closed",
          }),
        ),
      ),
    );

    const events: Realtime["Type"]["events"] = Stream.fromQueue(eventQueue).pipe(
      Stream.catchAll(() =>
        Stream.fail(
          new ProviderError({
            provider: adapter.name,
            reason: "Event stream closed",
          }),
        ),
      ),
    );

    const interrupt: Realtime["Type"]["interrupt"] = (playedAudioMs) =>
      adapter
        .onInterrupt({ socket, stateRef, audioQueue, eventQueue, playedAudioMs })
        .pipe(Effect.tap(() => Effect.log(`${adapter.name} interrupt`)));

    const submitToolOutput: Realtime["Type"]["submitToolOutput"] = (
      callId,
      name,
      output,
    ) => socket.send(adapter.encodeToolOutput(callId, name, output));

    const requestResponse: Realtime["Type"]["requestResponse"] = () => {
      if (adapter.encodeRequestResponse) {
        const msg = adapter.encodeRequestResponse();
        if (msg) return socket.send(msg);
      }
      return Effect.void;
    };

    const requiresExplicitRequestResponse =
      adapter.requiresExplicitRequestResponse ??
      !!(adapter.encodeRequestResponse?.() ?? null);

    return {
      send,
      receive,
      events,
      interrupt,
      submitToolOutput,
      requestResponse,
      requiresExplicitRequestResponse,
    };
  }).pipe(Effect.withSpan(`${adapter.name.toLowerCase()}.provider`));
}

const DefaultSessionContext = makeSessionContext({ sessionId: crypto.randomUUID() });

export function makeRealtimeLayer<Msg, State>(
  adapter: RealtimeAdapter<Msg, State>,
): Layer.Layer<Realtime, ProviderError, Scope.Scope | Agent> {
  return Layer.scoped(Realtime, makeRealtimeFromAdapter(adapter)).pipe(
    Layer.provideMerge(DefaultSessionContext),
  ) as Layer.Layer<Realtime, ProviderError, Scope.Scope | Agent>;
}
