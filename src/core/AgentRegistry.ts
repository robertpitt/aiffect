import { Context, Effect, Layer, Option } from "effect";
import type { AgentSpec } from "./Agent.js";

export interface AgentRegistryShape {
  readonly getAgent: (agentId: string) => Effect.Effect<Option.Option<AgentSpec>>;
}

export class AgentRegistry extends Context.Tag("@aiffect/AgentRegistry")<
  AgentRegistry,
  AgentRegistryShape
>() {}

/** Build an AgentRegistry layer from a record of agentId -> AgentSpec. */
export const makeAgentRegistry = (
  agents: Readonly<Record<string, AgentSpec>>,
): Layer.Layer<AgentRegistry> =>
  Layer.succeed(AgentRegistry, {
    getAgent: (agentId: string) => Effect.succeed(Option.fromNullable(agents[agentId])),
  });
