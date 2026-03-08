import { Effect, Layer, ServiceMap, Stream } from "effect";
import type { PipelineEvent } from "@/core/Events.js";
import type { PipelineError } from "@/core/Errors.js";

/**
 * Helper to create a Pipeline layer from an Effect that yields { run, events }.
 * Reduces boilerplate for custom pipelines.
 *
 * @example
 * const myPipeline = createPipeline(
 *   Effect.gen(function* () {
 *     const transport = yield* Transport;
 *     const realtime = yield* Realtime;
 *     return {
 *       run: pipe(transport.inbound, Stream.runDrain),
 *       events: Stream.empty,
 *     };
 *   })
 * );
 */
export function createPipeline<R, E>(
  effect: Effect.Effect<
    { run: Effect.Effect<void, PipelineError>; events: Stream.Stream<PipelineEvent, PipelineError> },
    E,
    R
  >,
): Layer.Layer<Pipeline, E, R> {
  return Layer.effect(Pipeline, effect);
}

export interface PipelineShape {
  readonly run: Effect.Effect<void, PipelineError>;
  readonly events: Stream.Stream<PipelineEvent, PipelineError>;
}

/**
 * Requirements for built-in pipelines. Realtime needs Transport | Realtime | Agent | Scope;
 * Sandwich needs Transport | STT | TTS | LanguageModel | Agent | Scope.
 */
export type PipelineRequirements =
  | import("./Transport.js").Transport
  | import("./Provider.js").Realtime
  | import("./Provider.js").STT
  | import("./Provider.js").TTS
  | import("effect/unstable/ai").LanguageModel.LanguageModel
  | import("./Agent.js").Agent
  | import("effect").Scope.Scope;

/**
 * @name Pipeline
 * @description The pipeline context that will be used to run the pipeline.
 */
export class Pipeline extends ServiceMap.Service<Pipeline, PipelineShape>()("@aiffect/Pipeline") {}
