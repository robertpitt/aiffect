/**
 * High-level session runner.
 *
 * Usage:
 *   import { Session, OpenAI, WebSocketTransport } from "aiffect-ts"
 *
 *   // Single agent
 *   Session.run({
 *     agent: myAgent,
 *     provider: OpenAI.realtime({ voice: "alloy" }),
 *     transport: WebSocketTransport(ws),
 *   })
 *
 *   // Multi-agent
 *   Session.run({
 *     agentId: "concierge",
 *     agents: { concierge, reservations },
 *     provider: OpenAI.realtime({ voice: "alloy" }),
 *     transport: WebSocketTransport(ws),
 *   })
 */

import { Effect, Fiber, Layer, Stream } from "effect";
import type { PipelineRequirements } from "@/core/Pipeline.js";
import type { Scope } from "effect";
import type { PipelineEvent } from "@/core/Events.js";
import { Pipeline } from "@/core/Pipeline.js";
import { Realtime } from "@/core/Provider.js";
import type { Transport } from "@/core/Transport.js";
import type { AgentContextShape } from "@/core/AgentContext.js";
import { makeAgentContext } from "@/core/AgentContext.js";
import { Agent, type AgentSpec } from "@/core/Agent.js";
import { AgentContext } from "@/core/AgentContext.js";
import { SessionContext } from "@/core/SessionContext.js";
import type { SessionContextShape } from "@/core/SessionContext.js";
import { makeSessionContext } from "@/core/SessionContext.js";
import { orRandomUuid } from "@/core/utils.js";
import {
  PipelineError,
  ConfigError,
  type ProviderError,
} from "@/core/Errors.js";
import { RealtimePipeline } from "@/pipelines/index.js";

export interface SessionOptions {
  /** Agent to use directly. Mutually exclusive with agentId + agents. */
  readonly agent?: AgentSpec;
  /** Agent ID to resolve from the agents record. */
  readonly agentId?: string;
  /** Record of available agents (used with agentId). */
  readonly agents?: Record<string, AgentSpec>;
  /** Provider layer (e.g. OpenAI.realtime({ voice: "alloy" })). */
  readonly provider: Layer.Layer<
    Realtime,
    ProviderError,
    Scope.Scope | Agent | SessionContext | AgentContext
  >;
  /** Transport layer (e.g. WebSocketTransport(ws)). */
  readonly transport: Layer.Layer<Transport>;
  /**
   * Pipeline layer. Defaults to `RealtimePipeline` when omitted.
   * Pass `SandwichPipeline` or `SandwichBargeInPipeline` for STT->LLM->TTS flows.
   */
  readonly pipeline?: Layer.Layer<Pipeline, never, PipelineRequirements>;
  /** Session metadata (observability anchor). Defaults to sessionId from random UUID. */
  readonly session?: Partial<SessionContextShape>;
  /** Per-spawn agent config (prompt settings, client details, menu ids, etc.). */
  readonly agentContext?: AgentContextShape;
  /** Server context layer (repositories, SDKs). Required when tools use ServerContext. */
  readonly serverContext?: Layer.Layer<import("@/core/ServerContext.js").ServerContext>;
}

function resolveAgent(
  options: SessionOptions,
): Effect.Effect<AgentSpec, ConfigError> {
  if (options.agent) return Effect.succeed(options.agent);
  if (options.agentId && options.agents) {
    const found = options.agents[options.agentId];
    if (found) return Effect.succeed(found);
    const available = Object.keys(options.agents).join(", ");
    return Effect.fail(
      new ConfigError({
        reason: available
          ? `Agent not found: "${options.agentId}". Available: ${available}`
          : `Agent not found: "${options.agentId}". No agents in record.`,
      }),
    );
  }
  return Effect.fail(
    new ConfigError({
      reason: "Either agent or (agentId + agents) must be provided",
    }),
  );
}

/**
 * Run a voice session with minimal configuration.
 * Composes the pipeline, provider, transport, and agent layers automatically.
 */
export const run = (
  options: SessionOptions,
): Effect.Effect<void, PipelineError | ConfigError | ProviderError> =>
  Effect.gen(function* () {
    const agent = yield* resolveAgent(options);
    const agentLayer = Layer.succeed(Agent, agent);
    const pipelineLayer = options.pipeline ?? RealtimePipeline;
    const sessionContextLayer = makeSessionContext({
      sessionId: orRandomUuid(options.session?.sessionId),
      connectionId: options.session?.connectionId,
      metadata: options.session?.metadata,
      providerOptions: options.session?.providerOptions,
    });
    const agentContextLayer = makeAgentContext(options.agentContext ?? {});

    let appLayer = pipelineLayer.pipe(
      Layer.provide(options.transport),
      Layer.provide(options.provider),
      Layer.provide(agentLayer),
      Layer.provide(sessionContextLayer),
      Layer.provide(agentContextLayer),
    );
    if (options.serverContext) {
      appLayer = appLayer.pipe(Layer.provide(options.serverContext));
    }

    yield* Effect.scoped(
      Layer.build(appLayer).pipe(
        Effect.flatMap((ctx) =>
          Effect.gen(function* () {
            yield* Effect.log("session starting");
            const pipeline = yield* Pipeline;
            yield* pipeline.run;
            yield* Effect.log("session ended cleanly");
          }).pipe(Effect.provide(ctx)),
        ),
      ),
    );
  }).pipe(
    Effect.withSpan("session"),
  ) as Effect.Effect<void, PipelineError | ConfigError | ProviderError>;

export interface SessionWithEvents {
  /** Fiber running the pipeline. Join to wait for completion, or interrupt to stop. */
  readonly fiber: Fiber.Fiber<void, PipelineError>;
  /** Stream of pipeline events. Subscribe before or during the session. */
  readonly events: Stream.Stream<PipelineEvent, PipelineError>;
}

/**
 * Run a voice session with access to the events stream.
 * The callback receives { fiber, events }; the scope stays open until the callback completes.
 * Use when you need to subscribe to events before or during the session.
 *
 * Example:
 *   yield* Session.runWithEvents(options, ({ fiber, events }) =>
 *     Effect.gen(function* () {
 *       yield* Effect.forkChild(Stream.runForEach(events, (e) => Effect.log(`Event: ${e._tag}`)));
 *       yield* Fiber.join(fiber);
 *     })
 *   );
 */
export const runWithEvents = <A, E>(
  options: SessionOptions,
  fn: (ctx: SessionWithEvents) => Effect.Effect<A, E>,
): Effect.Effect<
  A,
  PipelineError | ConfigError | ProviderError | E
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const agent = yield* resolveAgent(options);
      const agentLayer = Layer.succeed(Agent, agent);
      const pipelineLayer = options.pipeline ?? RealtimePipeline;
      const sessionContextLayer = makeSessionContext({
        sessionId: orRandomUuid(options.session?.sessionId),
        connectionId: options.session?.connectionId,
        metadata: options.session?.metadata,
        providerOptions: options.session?.providerOptions,
      });
      const agentContextLayer = makeAgentContext(options.agentContext ?? {});

      let appLayer = pipelineLayer.pipe(
        Layer.provide(options.transport),
        Layer.provide(options.provider),
        Layer.provide(agentLayer),
        Layer.provide(sessionContextLayer),
        Layer.provide(agentContextLayer),
      );
      if (options.serverContext) {
        appLayer = appLayer.pipe(Layer.provide(options.serverContext));
      }

      const ctx = yield* Layer.build(appLayer);
      return yield* Effect.gen(function* () {
        const pipeline = yield* Pipeline;
        yield* Effect.log("session starting");
        const fiber = yield* Effect.forkChild(pipeline.run);
        return yield* fn({ fiber, events: pipeline.events });
      }).pipe(Effect.provide(ctx));
    }),
  ).pipe(
    Effect.withSpan("session"),
  ) as Effect.Effect<A, PipelineError | ConfigError | ProviderError | E>;

/** Session namespace for run/runWithEvents. */
export const Session = { run, runWithEvents };
