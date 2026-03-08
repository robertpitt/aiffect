import { Data } from "effect";

/**
 * @name TransportError
 * @description Emitted when transport (e.g. WebSocket, audio I/O) fails.
 */
export class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}

/**
 * @name ProviderError
 * @description Emitted when a provider (Realtime, STT, TTS) fails.
 */
export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly provider: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

/**
 * @name PipelineError
 * @description Emitted when the pipeline run fails.
 */
export class PipelineError extends Data.TaggedError("PipelineError")<{
  readonly reason: string;
  readonly cause?: unknown;
}> {}

/**
 * @name ConfigError
 * @description Emitted when configuration is invalid or a requested resource is not found.
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly reason: string;
}> {}

/**
 * @name AgentError
 * @description Emitted when the agent or a tool handler fails.
 */
export class AgentError extends Data.TaggedError("AgentError")<{
  readonly reason: string;
  readonly toolName?: string;
  readonly cause?: unknown;
}> {}

/**
 * Centralised error mapping. Use in all pipelines to ensure consistent wrapping.
 */
export function toPipelineError(e: unknown, defaultReason = "Pipeline failed"): PipelineError {
  if (e instanceof PipelineError) return e;
  if (e instanceof ProviderError)
    return new PipelineError({ reason: e.reason, cause: e });
  if (e instanceof Error)
    return new PipelineError({ reason: e.message, cause: e });
  return new PipelineError({
    reason: typeof e === "string" ? e : defaultReason,
    cause: e,
  });
}

