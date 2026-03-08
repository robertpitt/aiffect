import { Context, Effect, Layer, Option } from "effect";
import type { AgentSpec } from "./Agent.js";

/**
 * @name AgentRegistryShape
 * @description The Agent Registry shape that will be used to resolve agents by id.
 */
export interface AgentRegistryShape {
  /**
   * @name getAgent
   * @description The function that will be used to resolve an agent by id.
   */
  readonly getAgent: (agentId: string) => Effect.Effect<Option.Option<AgentSpec>>;
}

/**
 * @name AgentRegistry
 * @description The Agent Registry context that will be used to resolve agents by id.
 */
export class AgentRegistry extends Context.Tag("@aiffect/AgentRegistry")<
  AgentRegistry,
  AgentRegistryShape
>() {}

/**
 * Build an AgentRegistry layer from a record of agentId -> AgentSpec.
 */
export const agents = (agents: Readonly<Record<string, AgentSpec>>): Layer.Layer<AgentRegistry> =>
  Layer.succeed(AgentRegistry, {
    getAgent: (agentId: string) => Effect.succeed(Option.fromNullable(agents[agentId])),
  });

/** Alias for agents — consistent with makeSessionContext, makeRuntime, etc. */
export const makeAgentRegistry = agents;
