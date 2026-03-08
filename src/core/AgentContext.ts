import { Layer, ServiceMap } from "effect";

/**
 * Per-spawn agent configuration: fine-grained settings, prompt overrides,
 * client details, menu ids, and other metadata for that particular agent instance.
 * NOT for SDKs or service instances — use ServerContext for those.
 */
export interface AgentContextShape {
  readonly promptSettings?: Record<string, unknown>;
  readonly clientDetails?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export class AgentContext extends ServiceMap.Service<
  AgentContext,
  AgentContextShape
>()("@aiffect/AgentContext") {}

export const makeAgentContext = (
  ctx: AgentContextShape = {},
): Layer.Layer<AgentContext> => Layer.succeed(AgentContext, ctx);

/** Read the current agent context (e.g. in buildPrompt). */
export const getAgentContext = AgentContext.useSync((ctx) => ctx);
