import { Context, Effect, Stream } from "effect";
import type { PipelineEvent } from "../schemas/Events.js";
import type { PipelineError } from "./Errors.js";

/**
 * @name PipelineShape
 * @description The pipeline shape that will be used to run the pipeline.
 */
export interface PipelineShape {
  /**
   * @name run
   * @description The function that will be used to run the pipeline.
   * May require services (e.g. ServerContext, SessionContext) that are provided by the app layer.
   */
  readonly run: Effect.Effect<void, PipelineError, unknown>;
  /**
   * @name events
   * @description The stream of events that will be used to run the pipeline.
   */
  readonly events: Stream.Stream<PipelineEvent, PipelineError>;
}

/**
 * @name Pipeline
 * @description The pipeline context that will be used to run the pipeline.
 */
export class Pipeline extends Context.Tag("@aiffect/Pipeline")<Pipeline, PipelineShape>() {}
