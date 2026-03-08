# API Tiers

The public API is organized into three tiers: **primary** (what most apps use), **composed** (swapping pipeline/provider/transport, events), and **custom** (building your own provider, transport, or pipeline).

---

## Primary API

Use these for typical voice sessions.

| Export | Description |
|--------|-------------|
| **Session.run(options)** | Run a voice session. Composes pipeline, provider, transport, and agent; runs until the connection ends. Returns `Effect<void, PipelineError \| ConfigError \| ProviderError>`. |
| **Session.runWithEvents(options, fn)** | Same as above but calls `fn({ fiber, events })` inside the session scope so you can subscribe to the event stream or join/interrupt the fiber. |
| **defineAgent(params)** | Build an agent from `name`, `buildPrompt`, `toolkit`, and `toolkitLayer`. Derives `handleToolCall` automatically. Prefer over constructing `AgentSpec` by hand. |
| **OpenAI.realtime(options?)** | Layer for OpenAI Realtime API. Options: `voice`, `model`, `inputAudioFormat`, `outputAudioFormat`, `turnDetection`, etc. |
| **Gemini.realtime(options?)** | Layer for Gemini Live API. |
| **WebSocketTransport(ws, options?)** | Transport layer from a WebSocket. Options: `sampleRate`, `channels`, `pingIntervalMs`, `queueCapacity`, `queueDropStrategy`. |

**Session options**

- **agent** — Use this agent (mutually exclusive with `agentId` + `agents`).
- **agentId** + **agents** — Resolve agent by ID from a record (multi-agent routing).
- **provider** — Layer for the AI provider (e.g. `OpenAI.realtime({ voice: "alloy" })`).
- **transport** — Layer for audio transport (e.g. `WebSocketTransport(ws)`).
- **pipeline** — Optional. Defaults to `RealtimePipeline`. Use `SandwichPipeline` or `SandwichBargeInPipeline(config?)` for STT→LLM→TTS.

---

## Composed API

Use when you swap pipelines, providers, or need the event stream.

| Export | Description |
|--------|-------------|
| **RealtimePipeline** | Default full-duplex pipeline (no constructor args). |
| **SandwichPipeline** | Turn-based STT → LLM → TTS (no barge-in). |
| **SandwichBargeInPipeline(config?)** | Same as Sandwich with energy-based barge-in. Optional `BargeInConfig`: `energyThreshold`, `frameThreshold`. |
| **PipelineEvent** | Discriminated union of event types: `TranscriptDelta`, `SpeechStarted`, `SpeechEnded`, `Interrupted`, `ToolCallStarted`, `ToolCallCompleted`, `ResponseStarted`, `ResponseCompleted`, `AudioOutputStarted`, `AudioOutputDone`. Use `event._tag` or the **isX** guards to narrow. |
| **isTranscriptDelta**, **isResponseCompleted**, etc. | Type guards for `PipelineEvent` (e.g. `isResponseCompleted(e)` → `e is ResponseCompleted`). |
| **SessionOptions**, **SessionWithEvents** | Types for `Session.run` / `Session.runWithEvents`. |
| **AgentSpec**, **AgentContext**, **DefineAgentParams** | Agent types. `DefineAgentParams` is the argument type for `defineAgent()`. |

---

## Custom API

Use when building a custom provider, transport, or pipeline.

| Area | Exports | Docs |
|------|---------|------|
| **Custom provider** | `makeRealtimeLayer`, `RealtimeAdapter`, `KernelInterruptCtx`, `MessageSocket`, `defaultOnSessionReady`, `defaultEncodeRequestResponse` | [CUSTOM_PROVIDER.md](./CUSTOM_PROVIDER.md) |
| **Custom transport** | `Transport`, `TransportShape`, `AudioFrame` | [CUSTOM_TRANSPORT.md](./CUSTOM_TRANSPORT.md) |
| **Custom pipeline** | `Pipeline`, `createPipeline`, `PipelineShape`, `PipelineRequirements` | [src/core/README.md](../src/core/README.md), [src/pipelines/README.md](../src/pipelines/README.md) |
| **Audio** | `RealtimeAudioConfig`, `RealtimeAudioConfigLive`, `AudioTransform`, `identityTransform` | Core audio transform for input/output (e.g. resampling). |
| **Context** | `SessionContext`, `makeSessionContext`, `getSession`, `ServerContext`, `AgentRegistry`, `makeAgentRegistry` | Session and server context for tools and agents. |
| **Errors** | `TransportError`, `ProviderError`, `PipelineError`, `ConfigError`, `AgentError`, `toPipelineError` | Tagged errors; use `toPipelineError` in custom pipelines for consistent wrapping. |
| **Observability** | `instrumentRealtime`, `makeEventBroadcast`, `inputTokensCounter`, `outputTokensCounter`, `trackTokenUsage` | Instrumentation and token metrics. |

---

## Errors

All session runs can fail with:

- **ConfigError** — Invalid options (e.g. missing agent, or `agentId` not in `agents`). Message includes available agent IDs when applicable.
- **ProviderError** — Provider (OpenAI, Gemini, etc.) failed.
- **PipelineError** — Pipeline or transport failure; often wraps another error.

Use `Effect.catchAll` or `Effect.catchAllCause` to handle them (e.g. log and exit, or retry).
