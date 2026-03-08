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
 * @name ToolDispatchError
 * @description Emitted when tool dispatch (invocation or result submission) fails.
 */
export class ToolDispatchError extends Data.TaggedError("ToolDispatchError")<{
  readonly reason: string;
  readonly toolName?: string;
  readonly callId?: string;
  readonly cause?: unknown;
}> {}

/**
 * @name SessionError
 * @description The union of all session/pipeline-related errors for typed failure channels.
 */
export type SessionError =
  | TransportError
  | ProviderError
  | PipelineError
  | ConfigError
  | AgentError
  | ToolDispatchError;
