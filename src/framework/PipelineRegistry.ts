import { Context, Effect, Layer } from "effect";
import { Pipeline } from "./Pipeline.js";
import { Realtime } from "./Provider.js";
import { Agent } from "./Agent.js";
import type { PipelineType } from "./SessionConfig.js";
import type { Transport } from "./Transport.js";
import type { Scope } from "effect";
import { ConfigError } from "./Errors.js";
import { make as RealtimePipeline } from "../pipelines/Realtime.js";

/**
 * @name PipelineLayerRequirements
 * @description The requirements that a pipeline layer typically needs (Transport, Realtime, Agent, Scope).
 */
export type PipelineLayerRequirements = Transport | Realtime | Agent | Scope.Scope;

/**
 * @name PipelineRegistryShape
 * @description The pipeline registry shape that will be used to resolve a pipeline layer by pipeline id.
 */
export interface PipelineRegistryShape {
  /**
   * @name getPipeline
   * @description The function that will be used to resolve a pipeline layer by pipeline id.
   */
  readonly getPipeline: (
    pipelineId: PipelineType,
  ) => Effect.Effect<Layer.Layer<Pipeline, never, PipelineLayerRequirements>, ConfigError>;
}

/**
 * @name PipelineRegistry
 * @description The pipeline registry context that will be used to resolve a pipeline layer by pipeline id.
 */
export class PipelineRegistry extends Context.Tag("@aiffect/PipelineRegistry")<
  PipelineRegistry,
  PipelineRegistryShape
>() {}

/**
 * @name PipelineRegistryLive
 * @description The pipeline registry layer that will be used to resolve a pipeline layer by pipeline id.
 */
export const PipelineRegistryLive: Layer.Layer<PipelineRegistry> = Layer.succeed(PipelineRegistry, {
  getPipeline: (pipelineId) => {
    if (pipelineId === "realtime") {
      return Effect.succeed(RealtimePipeline);
    }
    return Effect.fail(
      new ConfigError({
        reason: `pipeline ${pipelineId} not yet supported in runWithConfig`,
      }),
    );
  },
});
