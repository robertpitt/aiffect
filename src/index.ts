// ---------------------------------------------------------------------------
// High-level API
// ---------------------------------------------------------------------------

export * as Session from "./Session.js";
export type {
  SessionOptions,
  SessionWithEvents,
} from "./Session.js";

export {
  Agent,
  type AgentSpec,
  type AgentContext,
  type DefineAgentParams,
  defineAgent,
} from "./core/Agent.js";

// ---------------------------------------------------------------------------
// Providers (namespaced)
// ---------------------------------------------------------------------------

export * as OpenAI from "./providers/openai/index.js";
export * as Gemini from "./providers/gemini/index.js";

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export { fromWebSocket as WebSocketTransport } from "./transports/WebSocket.js";
export type {
  WebSocketTransportOptions,
  QueueDropStrategy,
} from "./transports/WebSocket.js";

// ---------------------------------------------------------------------------
// Core types (for advanced usage / custom providers)
// ---------------------------------------------------------------------------

export {
  Pipeline,
  createPipeline,
  type PipelineShape,
  type PipelineRequirements,
} from "./core/Pipeline.js";
export {
  Realtime,
  type RealtimeShape,
  STT,
  type STTShape,
  TTS,
  type TTSShape,
} from "./core/Provider.js";
export { Transport, type TransportShape } from "./core/Transport.js";
export { AudioFrame } from "./core/AudioFrame.js";
export type { PipelineEvent } from "./core/Events.js";
export {
  TranscriptDelta,
  SpeechStarted,
  SpeechEnded,
  Interrupted,
  ToolCallStarted,
  ToolCallCompleted,
  ToolCallError,
  ResponseStarted,
  ResponseCompleted,
  AudioOutputStarted,
  AudioOutputDone,
  isTranscriptDelta,
  isSpeechStarted,
  isSpeechEnded,
  isInterrupted,
  isToolCallStarted,
  isToolCallCompleted,
  isResponseStarted,
  isResponseCompleted,
  isAudioOutputStarted,
  isAudioOutputDone,
} from "./core/Events.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export {
  TransportError,
  ProviderError,
  PipelineError,
  ConfigError,
  AgentError,
  toPipelineError,
} from "./core/Errors.js";

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export { instrumentRealtime } from "./observability/InstrumentedRealtime.js";
export { make as makeEventBroadcast } from "./pipelines/EventBroadcast.js";
export {
  inputTokensCounter,
  outputTokensCounter,
  trackTokenUsage,
} from "./observability/UsageMetrics.js";

// ---------------------------------------------------------------------------
// Session context
// ---------------------------------------------------------------------------

export { AgentRegistry, makeAgentRegistry } from "./core/AgentRegistry.js";
export { ServerContext, type ServerContextShape } from "./core/ServerContext.js";
export {
  SessionContext,
  makeSessionContext,
  getSession,
  type SessionContextShape,
} from "./core/SessionContext.js";
// ---------------------------------------------------------------------------
// Audio transforms
// ---------------------------------------------------------------------------

export {
  RealtimeAudioConfig,
  RealtimeAudioConfigLive,
  type RealtimeAudioConfigShape,
  type AudioTransform,
  identityTransform,
} from "./core/AudioTransform.js";

// ---------------------------------------------------------------------------
// Pipelines (for advanced composition)
// ---------------------------------------------------------------------------

export { make as RealtimePipeline } from "./pipelines/Realtime.js";
export { make as SandwichPipeline } from "./pipelines/Sandwich.js";
export { make as SandwichBargeInPipeline } from "./pipelines/SandwichBargeIn.js";
export {
  type BargeInConfig,
  DEFAULT_ENERGY_THRESHOLD,
  DEFAULT_FRAME_THRESHOLD,
} from "./pipelines/BargeInConfig.js";

// ---------------------------------------------------------------------------
// Kernel (for building custom providers)
// ---------------------------------------------------------------------------

export {
  makeRealtimeLayer,
  type RealtimeAdapter,
  type KernelInterruptCtx,
  type MessageSocket,
  defaultOnSessionReady,
  defaultEncodeRequestResponse,
} from "./providers/RealtimeKernel.js";
