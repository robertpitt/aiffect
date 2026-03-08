import type { AgentContextShape } from "@/core/AgentContext.js";
import type { SessionContextShape } from "@/core/SessionContext.js";
import { Toolkit, type Tool } from "effect/unstable/ai";
import { Effect, Layer, ServiceMap } from "effect";
import { AgentError } from "@/core/Errors.js";

export interface AgentSpec {
  readonly name: string;
  readonly buildPrompt: (
    agentContext: AgentContextShape,
    sessionContext: SessionContextShape,
  ) => string;
  readonly toolkit: Toolkit.Any;
  readonly toolkitLayer: Layer.Layer<unknown, unknown, unknown>;
  /** Invoke a tool by name with parsed arguments. Fully self-contained (includes toolkitLayer). */
  readonly handleToolCall: (name: string, args: unknown) => Effect.Effect<unknown, AgentError>;
}

export interface DefineAgentParams {
  readonly name: string;
  readonly buildPrompt: (
    agentContext: AgentContextShape,
    sessionContext: SessionContextShape,
  ) => string;
  readonly toolkit: Toolkit.Any;
  readonly toolkitLayer: Layer.Layer<unknown, unknown, unknown>;
}

/**
 * Construct an AgentSpec with `handleToolCall` derived automatically from
 * the toolkit and toolkitLayer. Prefer this over manually constructing AgentSpec.
 *
 * @example
 * const agent = defineAgent({
 *   name: "Demo",
 *   buildPrompt: (agentCtx, sessionCtx) =>
 *     `Session ${sessionCtx.sessionId}. You are helpful.`,
 *   toolkit: DemoToolkit,
 *   toolkitLayer: DemoToolkitLive,
 * });
 */
export function defineAgent(spec: DefineAgentParams): AgentSpec {
  return {
    ...spec,
    handleToolCall: (name, args) =>
      Effect.gen(function* () {
        const handler = yield* spec.toolkit as unknown as Effect.Effect<
          Toolkit.WithHandler<Record<string, Tool.Any>>
        >;
        const result = yield* handler.handle(name as keyof Record<string, Tool.Any>, args as never);
        return result;
      }).pipe(
        Effect.provide(spec.toolkitLayer as unknown as Layer.Layer<never, never, never>),
        Effect.mapError(
          (cause) =>
            new AgentError({
              reason: String(cause),
              toolName: name,
              cause,
            }),
        ),
      ),
  };
}

export class Agent extends ServiceMap.Service<Agent, AgentSpec>()("@aiffect/Agent") {}
