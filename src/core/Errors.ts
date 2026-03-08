import { Schema } from "effect";

/**
 * @name TransportError
 * @description Emitted when transport (e.g. WebSocket, audio I/O) fails.
 */
export class TransportError extends Schema.TaggedErrorClass<TransportError>()("TransportError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * @name ProviderError
 * @description Emitted when a provider (Realtime, STT, TTS) fails.
 */
export class ProviderError extends Schema.TaggedErrorClass<ProviderError>()("ProviderError", {
  provider: Schema.String,
  reason: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * @name PipelineError
 * @description Emitted when the pipeline run fails.
 */
export class PipelineError extends Schema.TaggedErrorClass<PipelineError>()("PipelineError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * @name ConfigError
 * @description Emitted when configuration is invalid or a requested resource is not found.
 */
export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()("ConfigError", {
  reason: Schema.String,
}) {}

/**
 * @name AgentError
 * @description Emitted when the agent or a tool handler fails.
 */
export class AgentError extends Schema.TaggedErrorClass<AgentError>()("AgentError", {
  reason: Schema.String,
  toolName: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

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
