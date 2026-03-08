/**
 * Single type for session: config (agent, provider, pipeline, audio) plus runtime identity.
 * Use Session when reading current session in tools or pipeline; use SessionConfig when starting a session.
 */

/** Input audio format from the client/transport. */
export type InputAudioFormat = "pcm16" | "mulaw" | "alaw";

/** Output audio format for provider (e.g. pcm16, mulaw). */
export type OutputAudioFormat = "pcm16" | "mulaw" | "alaw";

/** Pipeline type: realtime (full-duplex) or sandwich variants. */
export type PipelineType = "realtime" | "sandwich" | "sandwichBargeIn";

/** Provider identifier for session-based provider selection. */
export type ProviderType = "openai" | "gemini" | "composable";

/** Config required to initialise the agent for this session. */
export interface AgentConfig {
  /** Agent id used to resolve Agent (prompt + toolkits) from registry. */
  readonly agentId: string;
  /** Provider-specific voice id (e.g. "alloy", "echo"). */
  readonly voice: string;
  /** TTS/speech speed if supported by provider (e.g. 0.8–1.2). */
  readonly speed?: number;
  /** Optional language hint for the agent. */
  readonly language?: string;
  /** Extra context passed to the agent (e.g. for buildPrompt). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Optional turn detection config for realtime (provider-specific). */
export interface TurnDetectionConfig {
  readonly threshold?: number;
  readonly prefixPaddingMs?: number;
  readonly silenceDurationMs?: number;
  readonly createResponse?: boolean;
  readonly interruptResponse?: boolean;
}

/** Full session: config + runtime identity. One type for tools and pipeline to read. */
export interface Session {
  /** All config required to initialise the agent for this session. */
  readonly agent: AgentConfig;
  readonly pipeline: PipelineType;
  readonly provider: ProviderType;
  /** Input audio format from transport (e.g. Twilio sends mulaw). */
  readonly inputAudioFormat: InputAudioFormat;
  /** Output audio format for provider (defaults from provider). */
  readonly outputAudioFormat?: OutputAudioFormat;
  readonly sampleRate: number;
  readonly channels: number;
  readonly turnDetection?: TurnDetectionConfig;
  readonly transcriptionModel?: string;
  readonly transcriptionLanguage?: string;
  readonly noiseReduction?: boolean;
  /** Set when session starts (e.g. crypto.randomUUID()). */
  readonly sessionId: string;
  /** Connection/request id; set when session starts if not provided. */
  readonly connectionId: string;
  /** Tenant or app-specific scope. */
  readonly tenant?: string;
  readonly [key: string]: unknown;
}

/** Input when starting a session: Session with sessionId/connectionId optional (framework sets them). */
export type SessionConfig = Omit<Session, "sessionId" | "connectionId"> & {
  readonly sessionId?: string;
  readonly connectionId?: string;
};
