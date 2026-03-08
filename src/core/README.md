# Core

Abstractions and types that define the voice pipeline: **Transport**, **Provider**, **Pipeline**, **Agent**, plus shared events, errors, and context.

---

## Module Overview

| Module | Purpose |
|--------|---------|
| **Transport.ts** | `Transport` context tag and `TransportShape`: inbound audio stream, `send`, optional `clear`. |
| **Provider.ts** | `Realtime`, `STT`, `TTS` context tags and their shapes (send/receive, transcribe, synthesize). |
| **Pipeline.ts** | `Pipeline` context tag, `PipelineShape` (`run`, `events`), `createPipeline` helper. |
| **Agent.ts** | `Agent` context tag, `AgentSpec`, `AgentContext`, `defineAgent()`. |
| **Events.ts** | Tagged pipeline events: `TranscriptDelta`, `SpeechStarted`/`SpeechEnded`, `Interrupted`, tool/response/audio events. |
| **Errors.ts** | `TransportError`, `ProviderError`, `PipelineError`, `ConfigError`, `AgentError`; `toPipelineError()`. |
| **AudioFrame.ts** | `AudioFrame` type (samples, sampleRate, channels, timestamp). |
| **AudioTransform.ts** | `RealtimeAudioConfig` for input/output transforms (e.g. resampling). |
| **SessionContext.ts** | `SessionContext` (sessionId, metadata); `makeSessionContext`, `getSession`. |
| **ServerContext.ts** | `ServerContext` shape for server-wide context. |
| **AgentRegistry.ts** | `AgentRegistry`, `makeAgentRegistry` for multi-agent lookup. |
| **RealtimeTypes.ts** | Shared types used by realtime providers. |
| **utils.ts** | Internal utilities. |

---

## Technical Flow (Layer Dependencies)

```
Pipeline (e.g. RealtimePipeline)
  ├── requires: Transport, Realtime (or STT/TTS/LanguageModel), Agent, RealtimeAudioConfig?, Scope
  ├── provides: Pipeline { run, events }
  └── run: starts concurrent fibers (inbound → provider, provider → outbound, events → tool dispatch / barge-in)

Transport (e.g. WebSocketTransport)
  ├── requires: (none)
  └── provides: Transport { inbound, send, clear? }

Provider (Realtime or STT + TTS + LanguageModel)
  ├── requires: Agent, Scope (for WebSocket lifecycle)
  └── provides: Realtime { send, receive, events, interrupt, submitToolOutput, requestResponse } etc.

Agent
  ├── requires: (none)
  └── provides: Agent { name, buildPrompt, toolkit, toolkitLayer, handleToolCall }
```

Session composition (see `Session.ts`) resolves the agent, builds `SessionContext`, then composes:

`pipeline ← transport ← provider ← agent ← sessionContext ← scope`.

---

## Event Model

All pipelines emit a unified `PipelineEvent` stream (see **Events.ts**):

- **Transcript** — `TranscriptDelta` (role, text, isFinal).
- **Speech / barge-in** — `SpeechStarted`, `SpeechEnded`, `Interrupted`.
- **Tools** — `ToolCallStarted`, `ToolCallCompleted` (or `ToolCallError`).
- **Response** — `ResponseStarted`, `ResponseCompleted` (with token counts).
- **Audio** — `AudioOutputStarted`, `AudioOutputDone`.

Consumers subscribe via `Session.runWithEvents(options, ({ events }) => ...)` or by using the pipeline’s `events` stream in custom pipelines.

---

## Error Handling

Errors are tagged by layer. Pipelines should use `toPipelineError()` to map provider/transport/agent failures into `PipelineError` for a consistent session exit type. See **Errors.ts** and [PROTOCOL.md](../../PROTOCOL.md) (Error Hierarchy).
