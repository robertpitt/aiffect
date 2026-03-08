import { Effect, Layer, Ref, Stream } from "effect";
import { Pipeline } from "../framework/Pipeline.js";
import { Transport } from "../framework/Transport.js";
import { Realtime } from "../framework/Provider.js";
import {
  RealtimeAudioConfigTag,
  defaultRealtimeAudioConfigLayer,
} from "../framework/AudioTransform.js";
import { PipelineError, ProviderError } from "../framework/Errors.js";
import { Agent } from "../framework/Agent.js";
import { make as makeBargeIn } from "../internal/BargeIn.js";
import { make as makeEventBroadcast } from "../internal/EventBroadcast.js";
import { dispatch as dispatchToolCall } from "../internal/ToolDispatch.js";
import { logEvent } from "../internal/EventLogger.js";
import { PipelineEventSink, PipelineEventSinkLive } from "../framework/PipelineEventSink.js";

/**
 * Realtime pipeline: bidirectional audio loop with three concurrent fibers,
 * composing BargeIn, EventBroadcast, and ToolDispatch.
 * Optional audio transforms (RealtimeAudioConfigTag) apply input/output stream conversion when provided.
 *
 *   1. pipeline.inbound  — Transport.inbound -> [inputTransform] -> Realtime.send
 *   2. pipeline.outbound — Realtime.receive -> [outputTransform] -> Transport.send (barge-in gating)
 *   3. pipeline.events   — Realtime.events -> barge-in state, broadcast, tool dispatch
 */
const makePipeline = Layer.effect(
  Pipeline,
  Effect.gen(function* () {
    const transport = yield* Transport;
    const realtime = yield* Realtime;
    const agent = yield* Agent;
    const audioConfig = yield* RealtimeAudioConfigTag;
    const eventBroadcast = yield* makeEventBroadcast;
    const bargeIn = yield* makeBargeIn;
    const eventSink = yield* PipelineEventSink;

    const wrapProviderError = (error: ProviderError) =>
      new PipelineError({ reason: error.reason, cause: error });

    const inboundFiber = Effect.gen(function* () {
      const frameCount = yield* Ref.make(0);
      const byteCount = yield* Ref.make(0);
      const inboundStream = audioConfig.inputTransform(transport.inbound);
      yield* inboundStream.pipe(
        Stream.tap((frame) =>
          Ref.update(frameCount, (n) => n + 1).pipe(
            Effect.flatMap(() => Ref.update(byteCount, (n) => n + frame.samples.byteLength)),
          ),
        ),
        Stream.mapEffect((frame) => realtime.send(frame)),
        Stream.catchAll((e) => Stream.fail(wrapProviderError(e as ProviderError))),
        Stream.runDrain,
      );
      const frames = yield* Ref.get(frameCount);
      const bytes = yield* Ref.get(byteCount);
      yield* Effect.annotateCurrentSpan("inbound.frames", frames);
      yield* Effect.annotateCurrentSpan("inbound.bytes", bytes);
      yield* Effect.annotateCurrentSpan("inbound.duration_estimate_ms", Math.round(frames * 20));
      yield* Effect.log("inbound fiber ended").pipe(
        Effect.annotateLogs("frames", frames),
        Effect.annotateLogs("bytes", bytes),
      );
    });

    const outboundFiber = Effect.gen(function* () {
      const frameCount = yield* Ref.make(0);
      const byteCount = yield* Ref.make(0);
      const droppedFrames = yield* Ref.make(0);
      const firstFrameTs = yield* Ref.make(0);
      const outboundStream = audioConfig.outputTransform(realtime.receive);
      yield* outboundStream.pipe(
        Stream.mapEffect((frame) =>
          Effect.gen(function* () {
            const gated = yield* bargeIn.isGated;
            if (gated) {
              yield* Ref.update(droppedFrames, (n) => n + 1);
              return;
            }
            const n = yield* Ref.getAndUpdate(frameCount, (c) => c + 1);
            yield* Ref.update(byteCount, (c) => c + frame.samples.byteLength);
            if (n === 0) yield* Ref.set(firstFrameTs, Date.now());
            const frameDurationMs = (frame.samples.byteLength / 2 / frame.sampleRate) * 1000;
            yield* bargeIn.trackPlayback(frameDurationMs);
            yield* transport.send(frame);
          }),
        ),
        Stream.catchAll((e) =>
          Stream.fail(new PipelineError({ reason: "Outbound error", cause: e })),
        ),
        Stream.runDrain,
      );
      const frames = yield* Ref.get(frameCount);
      const bytes = yield* Ref.get(byteCount);
      const dropped = yield* Ref.get(droppedFrames);
      const firstTs = yield* Ref.get(firstFrameTs);
      yield* Effect.annotateCurrentSpan("outbound.frames", frames);
      yield* Effect.annotateCurrentSpan("outbound.bytes", bytes);
      yield* Effect.annotateCurrentSpan("outbound.droppedFrames", dropped);
      if (firstTs > 0) {
        yield* Effect.annotateCurrentSpan("outbound.first_frame_ts", firstTs);
        yield* Effect.annotateCurrentSpan("outbound.active_duration_ms", Date.now() - firstTs);
      }
      yield* Effect.log("outbound fiber ended").pipe(
        Effect.annotateLogs("frames", frames),
        Effect.annotateLogs("bytes", bytes),
        Effect.annotateLogs("droppedFrames", dropped),
      );
    });

    const eventFiber = Effect.gen(function* () {
      const eventCount = yield* Ref.make(0);
      const toolCallCount = yield* Ref.make(0);
      const responseCount = yield* Ref.make(0);
      const pendingToolOutputRef = yield* Ref.make(false);
      yield* realtime.events.pipe(
        Stream.mapEffect((event) =>
          Effect.gen(function* () {
            yield* Ref.update(eventCount, (n) => n + 1);
            yield* logEvent(event);
            yield* bargeIn.onEvent(event);
            yield* eventBroadcast.publish(event);
            yield* eventSink.sink(event);
            if (event._tag === "ToolCallStarted") {
              yield* Ref.update(toolCallCount, (n) => n + 1);
              const completed = yield* dispatchToolCall(event, agent).pipe(
                Effect.provide(agent.toolkitLayer),
              );
              yield* logEvent(completed);
              yield* eventBroadcast.publish(completed);
              const toolOutput =
                completed.status === "success"
                  ? completed.result
                  : { error: completed.error?.reason ?? "tool_failed" };
              yield* realtime.submitToolOutput(completed.callId, completed.name, toolOutput);
              yield* Ref.set(pendingToolOutputRef, true);
            }
            if (event._tag === "ResponseCompleted") {
              const hadPending = yield* Ref.getAndSet(pendingToolOutputRef, false);
              if (hadPending) {
                yield* realtime.requestResponse();
              }
            }
            if (event._tag === "ResponseStarted") {
              yield* Ref.update(responseCount, (n) => n + 1);
            }
          }),
        ),
        Stream.catchAll((e) =>
          Stream.fail(new PipelineError({ reason: "Event processing error", cause: e })),
        ),
        Stream.runDrain,
      );
      const events = yield* Ref.get(eventCount);
      const tools = yield* Ref.get(toolCallCount);
      const responses = yield* Ref.get(responseCount);
      yield* Effect.annotateCurrentSpan("events.total", events);
      yield* Effect.annotateCurrentSpan("events.toolCalls", tools);
      yield* Effect.annotateCurrentSpan("events.responses", responses);
    });

    const run: Pipeline["Type"]["run"] = Effect.log("starting voice loop").pipe(
      Effect.flatMap(() => Effect.raceAll([inboundFiber, outboundFiber, eventFiber])),
      Effect.tap(() => Effect.log("voice loop ended")),
      Effect.catchAll((cause) =>
        Effect.fail(
          cause instanceof PipelineError
            ? cause
            : new PipelineError({ reason: "Pipeline failed", cause }),
        ),
      ),
    );

    return { run, events: eventBroadcast.subscribe };
  }),
);

/** Pipeline layer; uses passthrough audio transforms and no-op event sink by default. */
export const make: Layer.Layer<
  Pipeline,
  never,
  Transport | Realtime | Agent | import("effect").Scope.Scope
> = makePipeline.pipe(
  Layer.provideMerge(defaultRealtimeAudioConfigLayer),
  Layer.provideMerge(PipelineEventSinkLive),
);
