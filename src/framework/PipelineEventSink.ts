import { Context, Effect, Layer } from "effect";
import type { PipelineEvent } from "../schemas/Events.js";

/**
 * @name PipelineEventSinkShape
 * @description The pipeline event sink shape that will be used to process the pipeline events.
 */
export interface PipelineEventSinkShape {
  /**
   * @name sink
   * @description The function that will be used to process the pipeline events.
   */
  readonly sink: (event: PipelineEvent) => Effect.Effect<void>;
}

/**
 * @name PipelineEventSink
 * @description The pipeline event sink context that will be used to process the pipeline events.
 */
export class PipelineEventSink extends Context.Tag("@aiffect/PipelineEventSink")<
  PipelineEventSink,
  PipelineEventSinkShape
>() {}

/**
 * @name PipelineEventSinkLive
 * @description The pipeline event sink layer that will be used to process the pipeline events.
 */
export const PipelineEventSinkLive: Layer.Layer<PipelineEventSink> = Layer.succeed(
  PipelineEventSink,
  { sink: () => Effect.void },
);
