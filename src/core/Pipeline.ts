import { Context, Effect, Layer, Stream } from "effect";
import type { PipelineEvent } from "./Events.js";
import type { PipelineError } from "./Errors.js";

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
  | import("@effect/ai").LanguageModel.LanguageModel
  | import("./Agent.js").Agent
  | import("effect").Scope.Scope;

/**
 * @name Pipeline
 * @description The pipeline context that will be used to run the pipeline.
 */
export class Pipeline extends Context.Tag("@aiffect/Pipeline")<Pipeline, PipelineShape>() {}
