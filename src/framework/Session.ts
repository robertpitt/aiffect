import { Effect, Layer, Option, Runtime, Scope } from "effect";
import { Pipeline } from "./Pipeline.js";
import { ConfigError, type PipelineError } from "./Errors.js";
import { AgentRegistry } from "./AgentRegistry.js";
import { ProviderRegistry } from "./ProviderRegistry.js";
import { PipelineRegistry } from "./PipelineRegistry.js";
import { ServerContext } from "./ServerContext.js";
import { makeSessionContext } from "./SessionContext.js";
import type { Session, SessionConfig } from "./SessionConfig.js";
import { orRandomUuid } from "./utils.js";
import { Agent, type AgentSpec } from "./Agent.js";
import type { Transport } from "./Transport.js";

/**
 * @name SessionRunEnv
 * @description The environment required to run `runWithConfig` or `SessionRunner.run`: AgentRegistry, ProviderRegistry, PipelineRegistry, ServerContext.
 */
export type SessionRunEnv = AgentRegistry | ProviderRegistry | PipelineRegistry | ServerContext;

/**
 * @name runWithConfigRequired
 * @description The tags that must be provided to run `runWithConfig` or `SessionRunner.run` with config.
 */
export const runWithConfigRequired = [
  AgentRegistry,
  ProviderRegistry,
  PipelineRegistry,
  ServerContext,
] as const;

/**
 * @name toSession
 * @description The function that will be used to build a session from a session config.
 */
function toSession(config: SessionConfig): Session {
  const sessionId = orRandomUuid(config.sessionId);
  const connectionId = orRandomUuid(config.connectionId);
  return { ...config, sessionId, connectionId } as Session;
}

/**
 * Resolve agent by id and initialise for this session. Session is set once and passed to buildPrompt every time.
 */
function resolveAndInitialiseAgent(
  session: Session,
  getAgent: (id: string) => Effect.Effect<Option.Option<AgentSpec>>,
): Effect.Effect<AgentSpec, ConfigError> {
  const agentCfg = session.agent;
  return Effect.gen(function* () {
    const agentOpt = yield* getAgent(agentCfg.agentId);
    const base = yield* Option.match(agentOpt, {
      onNone: () =>
        Effect.fail(new ConfigError({ reason: `Agent not found: ${agentCfg.agentId}` })),
      onSome: (a) => Effect.succeed(a),
    });
    const initialised: AgentSpec = {
      ...base,
      buildPrompt: (ctx) =>
        base.buildPrompt({
          ...ctx,
          metadata: { ...agentCfg.metadata, ...ctx.metadata },
          session,
        }),
    };
    return initialised;
  });
}

/**
 * @name ConnectionMetadata
 * @description The metadata that will be used to run a session.
 */
export interface ConnectionMetadata {
  readonly connectionId: string;
  readonly [key: string]: unknown;
}

/**
 * Run a voice session from SessionConfig and a Transport layer.
 * Resolves the agent from AgentRegistry by config.agentId, builds Provider and Pipeline
 * from config, then runs the pipeline. SessionContext and ServerContext are provided
 * into the app layer so agents and tools can access session scope and repositories/services.
 */
export const runWithConfig = (config: SessionConfig, transportLayer: Layer.Layer<Transport>) =>
  Effect.gen(function* () {
    const session = toSession(config);
    const agentRegistry = yield* AgentRegistry;
    const providerRegistry = yield* ProviderRegistry;
    const pipelineRegistry = yield* PipelineRegistry;
    const serverContext = yield* ServerContext;

    const agent = yield* resolveAndInitialiseAgent(session, (id) => agentRegistry.getAgent(id));
    const providerLayer = yield* providerRegistry.getProvider(session.provider, {
      voice: session.agent.voice,
    });
    const pipelineLayer = yield* pipelineRegistry.getPipeline(session.pipeline);
    const agentLayer = Layer.succeed(Agent, agent);
    const sessionContextLayer = makeSessionContext(session);
    const serverContextLayer = Layer.succeed(ServerContext, serverContext);

    const appLayer = pipelineLayer.pipe(
      Layer.provide(transportLayer),
      Layer.provide(providerLayer),
      Layer.provide(agentLayer),
      Layer.provide(sessionContextLayer),
      Layer.provide(serverContextLayer),
      Layer.provide(Layer.scope),
    );

    yield* Effect.scoped(
      Layer.build(appLayer).pipe(
        Effect.flatMap((ctx) =>
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan("session.connectionId", session.connectionId);
            yield* Effect.log("session starting (runWithConfig)");
            const pipeline = yield* Pipeline;
            yield* pipeline.run;
            yield* Effect.log("session ended cleanly");
          }).pipe(Effect.provide(ctx)),
        ),
      ),
    );
  }).pipe(
    Effect.withSpan("session", {
      attributes: {
        "session.agentId": (config as Session).agent.agentId,
        "session.pipeline": (config as Session).pipeline,
        "session.provider": (config as Session).provider,
        "session.connectionId": (config as Session).connectionId ?? "unknown",
      },
    }),
  ) as Effect.Effect<void, PipelineError | ConfigError, SessionRunEnv>;

/**
 * Build a process-scoped runtime from a layer that provides AgentRegistry, ProviderRegistry, and PipelineRegistry.
 * Use once at startup inside a long-lived scope; then for each connection run
 * `SessionRunner.run({ transport, config, runtime })` (no env needed per call).
 *
 * Example: Layer.mergeAll(AgentRegistryLive, ProviderRegistryLive, PipelineRegistryLive).
 */
export const makeRuntime = <E>(
  serverLayer: Layer.Layer<SessionRunEnv, E>,
): Effect.Effect<Runtime.Runtime<SessionRunEnv>, E, Scope.Scope> => Layer.toRuntime(serverLayer);

export interface SessionRunOptions {
  readonly transport: Layer.Layer<Transport>;
  readonly config: SessionConfig;
  /**
   * When provided, the returned Effect has no environment requirement (run with Effect.runPromise).
   * When omitted, the Effect requires SessionRunEnv (AgentRegistry, ProviderRegistry, PipelineRegistry).
   */
  readonly runtime?: Runtime.Runtime<SessionRunEnv>;
}

/**
 * High-level session runner: one call with transport + config (and optional process runtime).
 * Resolves agent from registry, builds provider and pipeline from config, runs the session.
 *
 * - With `runtime`: runs the session using the process runtime; only the connection layer is built per call.
 *   Returns an Effect that requires no environment (run with Effect.runPromise).
 * - Without `runtime`: requires AgentRegistry in the environment (same as runWithConfig).
 */
export const SessionRunner = {
  run: (
    options: SessionRunOptions,
  ): Effect.Effect<void, PipelineError | ConfigError, SessionRunEnv> => {
    const { transport, config, runtime } = options;
    const sessionEffect = runWithConfig(config, transport);
    if (runtime !== undefined) {
      return Effect.promise(() =>
        Runtime.runPromise(runtime as Runtime.Runtime<SessionRunEnv>, sessionEffect),
      );
    }
    return sessionEffect;
  },
};
