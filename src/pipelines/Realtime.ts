import { Effect, Layer, Ref, Stream } from "effect";
import { Pipeline } from "@/core/Pipeline.js";
import { Transport } from "@/core/Transport.js";
import { Realtime } from "@/core/Provider.js";
import {
  RealtimeAudioConfig,
  RealtimeAudioConfigLive,
} from "@/core/AudioTransform.js";
import { toPipelineError } from "@/core/Errors.js";
import { Agent } from "@/core/Agent.js";
import { make as makeBargeIn } from "@/pipelines/BargeIn.js";
import { make as makeEventBroadcast } from "@/pipelines/EventBroadcast.js";
import { dispatch as dispatchToolCall } from "@/pipelines/ToolDispatch.js";
import { logEvent } from "@/observability/EventLogger.js";
import { instrumentRealtime } from "@/observability/InstrumentedRealtime.js";

/**
 * Realtime pipeline: bidirectional audio loop with three concurrent fibers,
 * composing BargeIn, EventBroadcast, and ToolDispatch.
 *
 *   1. inbound  -- Transport.inbound -> [inputTransform] -> Realtime.send
 *   2. outbound -- Realtime.receive -> [outputTransform] -> Transport.send (barge-in gating)
 *   3. events   -- Realtime.events -> barge-in state, broadcast, tool dispatch
 */
const makePipeline = Layer.effect(
  Pipeline,
  Effect.gen(function* () {
    const transport = yield* Transport;
    const rawRealtime = yield* Realtime;
    const realtime = instrumentRealtime(rawRealtime);
    const agent = yield* Agent;
    const audioConfig = yield* RealtimeAudioConfig;
    const eventBroadcast = yield* makeEventBroadcast;
    const bargeIn = yield* makeBargeIn;

    const inboundFiber = audioConfig.inputTransform(transport.inbound).pipe(
      Stream.mapEffect((frame) => realtime.send(frame)),
      Stream.catch((e) => Stream.fail(toPipelineError(e))),
      Stream.runDrain,
    );

    const outboundFiber = Effect.gen(function* () {
      const outboundStream = audioConfig.outputTransform(realtime.receive);
      yield* outboundStream.pipe(
        Stream.mapEffect((frame) =>
          Effect.gen(function* () {
            const gated = yield* bargeIn.isGated;
            if (gated) return;
            const frameDurationMs =
              (frame.samples.byteLength / 2 / frame.sampleRate) * 1000;
            yield* bargeIn.trackPlayback(frameDurationMs);
            yield* transport.send(frame);
          }),
        ),
        Stream.catch((e) =>
          Stream.fail(toPipelineError(e, "Outbound error")),
        ),
        Stream.runDrain,
      );
    });

    const eventFiber = Effect.gen(function* () {
      const pendingToolOutputRef = yield* Ref.make(false);
      yield* realtime.events.pipe(
        Stream.mapEffect((event) =>
          Effect.gen(function* () {
            yield* bargeIn.onEvent(event);
            yield* eventBroadcast.publish(event);
            if (event._tag === "ToolCallStarted") {
              const completed = yield* dispatchToolCall(event, agent);
              yield* logEvent(completed);
              yield* eventBroadcast.publish(completed);
              const toolOutput =
                completed.status === "success"
                  ? completed.result
                  : {
                      error:
                        completed.error?.reason ?? "tool_failed",
                    };
              yield* realtime.submitToolOutput(
                completed.callId,
                completed.name,
                toolOutput,
              );
              yield* Ref.set(pendingToolOutputRef, true);
            }
            if (event._tag === "ResponseCompleted") {
              const hadPending = yield* Ref.getAndSet(
                pendingToolOutputRef,
                false,
              );
              if (
                hadPending &&
                realtime.requiresExplicitRequestResponse !== false
              ) {
                yield* realtime.requestResponse();
              }
            }
          }),
        ),
        Stream.catch((e) =>
          Stream.fail(toPipelineError(e, "Event processing error")),
        ),
        Stream.runDrain,
      );
    });

    const run: Pipeline["Service"]["run"] = Effect.log(
      "starting voice loop",
    ).pipe(
      Effect.flatMap(() =>
        Effect.raceAll([inboundFiber, outboundFiber, eventFiber]),
      ),
      Effect.tap(() => Effect.log("voice loop ended")),
      Effect.catch((cause) => Effect.fail(toPipelineError(cause))),
    );

    return { run, events: eventBroadcast.subscribe };
  }),
);

export const make: Layer.Layer<
  Pipeline,
  never,
  Transport | Realtime | Agent | import("effect").Scope.Scope
> = makePipeline.pipe(
  Layer.provideMerge(RealtimeAudioConfigLive),
);
