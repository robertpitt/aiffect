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
import type { PipelineRequirements } from "./core/Pipeline.js";
import type { Scope } from "effect";
import type { PipelineEvent } from "./core/Events.js";
import { Pipeline } from "./core/Pipeline.js";
import { Realtime } from "./core/Provider.js";
import type { Transport } from "./core/Transport.js";
import { Agent, type AgentSpec } from "./core/Agent.js";
import { makeSessionContext } from "./core/SessionContext.js";
import {
  PipelineError,
  ConfigError,
  type ProviderError,
} from "./core/Errors.js";
import { make as RealtimePipeline } from "./pipelines/Realtime.js";

export interface SessionOptions {
  /** Agent to use directly. Mutually exclusive with agentId + agents. */
  readonly agent?: AgentSpec;
  /** Agent ID to resolve from the agents record. */
  readonly agentId?: string;
  /** Record of available agents (used with agentId). */
  readonly agents?: Record<string, AgentSpec>;
  /** Provider layer (e.g. OpenAI.realtime({ voice: "alloy" })). */
  readonly provider: Layer.Layer<Realtime, ProviderError, Scope.Scope | Agent>;
  /** Transport layer (e.g. WebSocketTransport(ws)). */
  readonly transport: Layer.Layer<Transport>;
  /**
   * Pipeline layer. Defaults to `RealtimePipeline` when omitted.
   * Pass `SandwichPipeline` or `SandwichBargeInPipeline` for STT->LLM->TTS flows.
   */
  readonly pipeline?: Layer.Layer<Pipeline, never, PipelineRequirements>;
}

function resolveAgent(
  options: SessionOptions,
): Effect.Effect<AgentSpec, ConfigError> {
  if (options.agent) return Effect.succeed(options.agent);
  if (options.agentId && options.agents) {
    const found = options.agents[options.agentId];
    if (found) return Effect.succeed(found);
    return Effect.fail(
      new ConfigError({
        reason: `Agent not found: ${options.agentId}`,
      }),
    );
  }
  return Effect.fail(
    new ConfigError({
      reason: "Either agent or agents + agentId must be provided",
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
      sessionId: crypto.randomUUID(),
    });

    const appLayer = pipelineLayer.pipe(
      Layer.provide(options.transport),
      Layer.provide(options.provider),
      Layer.provide(agentLayer),
      Layer.provide(sessionContextLayer),
      Layer.provide(Layer.scope),
    );

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
  readonly fiber: Fiber.RuntimeFiber<void, PipelineError>;
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
 *       yield* Effect.fork(Stream.runForEach(events, (e) => Effect.log(`Event: ${e._tag}`)));
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
        sessionId: crypto.randomUUID(),
      });

      const appLayer = pipelineLayer.pipe(
        Layer.provide(options.transport),
        Layer.provide(options.provider),
        Layer.provide(agentLayer),
        Layer.provide(sessionContextLayer),
        Layer.provide(Layer.scope),
      );

      const ctx = yield* Layer.build(appLayer);
      return yield* Effect.gen(function* () {
        const pipeline = yield* Pipeline;
        yield* Effect.log("session starting");
        const fiber = yield* Effect.fork(pipeline.run);
        return yield* fn({ fiber, events: pipeline.events });
      }).pipe(Effect.provide(ctx));
    }),
  ).pipe(
    Effect.withSpan("session"),
  ) as Effect.Effect<A, PipelineError | ConfigError | ProviderError | E>;
